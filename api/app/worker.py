"""Background AI worker: consume `jobs` and fill receipt fields.

Runs in-process (started from the app lifespan). It is trusted system code that
processes the queue across firms, so it uses the OWNER connection (RLS-bypass)
and scopes every query explicitly by the job's firm/client. Each job runs the
firm's configured provider (firms.ai_config) for STT / OCR, then the `format`
step to extract structured fields.
"""

import asyncio
import io
import logging
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

import fitz  # PyMuPDF: PDFをページ単位の1ページPDFに分割(再ラスタライズせずページをコピー)
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from . import dedup, journaling, storage
from .ai import factory
from .ai.base import ExtractedReceipt
from .config import get_settings
from .models import (
    UNPARSED_VENDOR,
    Client,
    File,
    Firm,
    Job,
    Receipt,
    ReceiptFile,
    ReceiptSource,
)

settings = get_settings()
# Owner engine — trusted worker, bypasses RLS (scopes by job.firm_id/client_id).
_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


def _parse_date(s) -> datetime | None:
    """OCR の date(YYYY-MM-DD 等) を captured_at 用の datetime に。失敗時 None。"""
    if not s:
        return None
    txt = str(s).strip().replace("/", "-").replace(".", "-")[:10]
    try:
        return datetime.combine(date.fromisoformat(txt), time(0, 0), tzinfo=timezone.utc)
    except ValueError:
        return None


def _apply_fields(receipt: Receipt, fields) -> None:
    """Fill receipt fields from an extraction. Replaces the 未解析 upload placeholder
    but never clobbers a value a human already entered."""
    if receipt.vendor == UNPARSED_VENDOR and fields.vendor:
        receipt.vendor = fields.vendor
    else:
        receipt.vendor = receipt.vendor or fields.vendor
    # 日付: アップロード時は登録日(今日)。解析できたら領収書の日付に置き換える。
    parsed_date = _parse_date(getattr(fields, "date", None))
    if parsed_date:
        receipt.captured_at = parsed_date
    receipt.amount_jpy = receipt.amount_jpy or fields.amount_jpy
    receipt.subtotal_jpy = receipt.subtotal_jpy or fields.subtotal_jpy
    receipt.tax_jpy = receipt.tax_jpy or fields.tax_jpy
    receipt.tax_10_jpy = receipt.tax_10_jpy or fields.tax_10_jpy
    receipt.tax_8_jpy = receipt.tax_8_jpy or fields.tax_8_jpy
    receipt.tax_mode = receipt.tax_mode or fields.tax_mode
    receipt.payment_method = receipt.payment_method or fields.payment_method
    receipt.t_number = receipt.t_number or fields.t_number
    receipt.description = receipt.description or getattr(fields, "description", None)
    # 取引先(自由入力)の初期値は店舗名(OCR)。未引当でも取引先が空にならないように。
    if not receipt.partner_name and receipt.vendor and receipt.vendor != UNPARSED_VENDOR:
        receipt.partner_name = receipt.vendor


async def _autolink_partner(session, receipt: Receipt) -> None:
    """OCR後、取引先が未設定なら完全一致だけで自動引当する（推測はしない）。"""
    if receipt.partner_id is None:
        receipt.partner_id = await journaling.exact_partner_id(session, receipt)


def _mark_parse_outcome(receipt: Receipt) -> None:
    """AI 解析後に「請求書として認識できたか」を capture_meta に記録する。
    店舗名(取引先)も金額も取れなければ未認識=失敗として印を付け、受信箱で『未解析』
    ではなく『認識できなかった』と出し分けられるようにする。認識できたら印を消す。
    JSONB は in-place 変更を追跡しないので必ず新しい dict を代入する。"""
    unresolved = receipt.vendor in (None, UNPARSED_VENDOR) and receipt.amount_jpy is None
    meta = dict(receipt.capture_meta or {})
    if unresolved:
        meta["parse_failed"] = True
    else:
        meta.pop("parse_failed", None)
    receipt.capture_meta = meta


# --- AI送信前の整形（全取込経路で共通。無駄なトークン消費を避ける） ----------
# 画像は長辺を抑えて再エンコード（保存原本は触らない）。PDF は生のまま渡す
# （Gemini が全ページを読む。画像化＝再ラスタライズはしない＝劣化もトークン増もさせない）。
_AI_IMAGE_MAX_EDGE = 1600  # 画像の長辺上限(px)。領収書OCRはこの程度で十分。
_AI_JPEG_QUALITY = 82
_AI_MAX_TOTAL_BYTES = 15 * 1024 * 1024  # 1リクエストでAIに送る合計上限(Gemini inline ~20MB 未満)
_AI_MAX_PDF_PAGES = 30  # 1つのPDFで処理する最大ページ数(トークン保護)


def _downscale_image(data: bytes) -> bytes:
    """画像を長辺 _AI_IMAGE_MAX_EDGE 以下に縮小し JPEG 再エンコードした“AI送信用コピー”を返す
    （保存済み原本は変えない）。縮小できない形式等は原本のまま返す。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        if max(img.size) > _AI_IMAGE_MAX_EDGE:
            img.thumbnail((_AI_IMAGE_MAX_EDGE, _AI_IMAGE_MAX_EDGE))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_AI_JPEG_QUALITY)
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — 縮小不可な形式は原本のまま送る
        return data


def _pdf_pages(data: bytes) -> list[bytes]:
    """複数ページPDFを「1ページのPDF」の配列に分割する。ページの中身(埋め込み画像等)はそのまま
    コピーするので再ラスタライズ＝画質劣化はしない。最大 _AI_MAX_PDF_PAGES ページまで。"""
    pages: list[bytes] = []
    src = fitz.open(stream=data, filetype="pdf")
    try:
        for i in range(min(src.page_count, _AI_MAX_PDF_PAGES)):
            one = fitz.open()
            one.insert_pdf(src, from_page=i, to_page=i)
            pages.append(one.tobytes())
            one.close()
    finally:
        src.close()
    return pages


async def _prep_ai_inputs(files: list[File]) -> list[tuple[bytes, str, File, int | None]]:
    """AIに渡す入力を用意。PDFは「ページ単位の1ページPDF」に分割し(どのページ由来か分かる＋
    1リクエストが小さくなる)、画像は縮小。返り値 [(送信バイト, mime, 元File, ページ番号 or None)]。"""
    out: list[tuple[bytes, str, File, int | None]] = []
    total = 0
    for f in files:
        data = await run_in_threadpool(storage.get, f.path)
        if "pdf" in (f.mime or "").lower() or f.kind == "pdf":
            try:
                pages = await run_in_threadpool(_pdf_pages, data)
            except Exception:  # noqa: BLE001 — 分割できないPDFは丸ごと1件として扱う
                pages = [data]
            for pno, page_bytes in enumerate(pages, start=1):
                if out and total + len(page_bytes) > _AI_MAX_TOTAL_BYTES:
                    break
                total += len(page_bytes)
                out.append((page_bytes, "application/pdf", f, pno))
        else:
            payload = await run_in_threadpool(_downscale_image, data)
            if out and total + len(payload) > _AI_MAX_TOTAL_BYTES:
                continue
            total += len(payload)
            out.append((payload, "image/jpeg", f, None))
    return out


async def _extract_grouped(
    ocr, files: list[File], audio: tuple[bytes, str] | None
) -> list[tuple[ExtractedReceipt, File, int | None]] | None:
    """全経路で共通のビジョン抽出。返り値 (項目, 元File, ページ番号)。provider 非対応なら None。
    - モバイル撮影セット(音声あり): 音声をセット全体に対応付けるため全入力を1回で送る。
    - それ以外(Web/Gmail。PDFはページ分割済み): 入力(=ページ)ごとに分けて送る。各領収書がどの
      ページ由来か分かり、1リクエストが小さくタイムアウトしにくく、1ページ失敗でも他は残る。"""
    inputs = await _prep_ai_inputs(files)
    if not inputs:
        return []
    if audio is not None:
        items = await ocr.extract_batch([(b, m) for b, m, _, _ in inputs], audio[0], audio[1])
        if items is None:
            return None
        out = []
        for it in items:
            idx = it.image_index if 0 <= it.image_index < len(inputs) else 0
            out.append((it, inputs[idx][2], inputs[idx][3]))
        return out
    grouped: list[tuple[ExtractedReceipt, File, int | None]] = []
    failures = 0
    for payload, mime, f, page in inputs:
        try:
            items = await ocr.extract_batch([(payload, mime)], None, "")
        except Exception:  # noqa: BLE001 — このページは飛ばして続行(全滅を防ぐ)
            logging.getLogger("worker").exception("page extract failed file=%s page=%s", f.id, page)
            failures += 1
            continue
        if items is None:
            return None
        for it in items:
            grouped.append((it, f, page))
    if failures and failures == len(inputs):
        raise RuntimeError(f"all {failures} page(s) failed to extract")
    return grouped


def _seed_memo(file: File, page, audio_transcript) -> str | None:
    """取込時のメモ初期値: ファイル名 / ページ / 音声の文字起こし(あるものだけ)。以後ユーザーが編集可。"""
    lines = []
    if file is not None and file.filename:
        lines.append(f"ファイル: {file.filename}")
    if page is not None:
        lines.append(f"ページ: {page}")
    if audio_transcript:
        lines.append(f"音声: {audio_transcript}")
    return "\n".join(lines) or None


async def _create_receipt_from_item(
    session, *, firm_id, client_id, source, created_by, capture_meta, file: File, item, page=None
) -> Receipt:
    """1件分の Receipt を起こしてファイルを紐付け、抽出項目(あれば)を反映する。page があれば
    capture_meta.page に記録。memo に「ファイル名/ページ/音声」を初期値で入れる。item が None は未解析。"""
    meta = dict(capture_meta or {})
    if page is not None:
        meta["page"] = page
    receipt = Receipt(
        firm_id=firm_id,
        client_id=client_id,
        source=source,
        doc_type=(item.doc_type if item else "receipt"),
        vendor=UNPARSED_VENDOR,
        capture_meta=meta,
        memo=_seed_memo(file, page, item.audio_transcript if item is not None else None),
        created_by=created_by,
    )
    session.add(receipt)
    await session.flush()
    session.add(ReceiptFile(receipt_id=receipt.id, file_id=file.id, kind="capture"))
    if item is not None:
        _apply_fields(receipt, item)
        await _autolink_partner(session, receipt)
    _mark_parse_outcome(receipt)
    return receipt


async def _process_batch(session, job: Job, cfg: dict) -> None:
    """撮影セット/一括: 画像/PDF + 任意の音声を1回のマルチモーダル呼び出しで解析し、含まれる
    領収書/カード明細行をすべて Receipt として起こす。1入力から複数件(複数領収書・明細の各行・
    PDFの複数ページ)は同じファイルを共有。Web/Gmail/モバイルすべて同じ抽出(extract_batch)。"""
    image_ids = job.params.get("image_file_ids") or []
    audio_id = job.params.get("audio_file_id")
    uploaded_by = job.params.get("uploaded_by")
    if not image_ids:
        raise ValueError("batch job requires image_file_ids")

    files: list[File] = []
    for fid in image_ids:
        f = await session.get(File, UUID(fid))
        if f:
            files.append(f)
    if not files:
        raise ValueError("batch job: no image files found")

    audio = None
    audio_file = await session.get(File, UUID(audio_id)) if audio_id else None
    if audio_file:
        audio_bytes = await run_in_threadpool(storage.get, audio_file.path)
        audio = (audio_bytes, audio_file.mime or "audio/mp4")

    grouped = await _extract_grouped(factory.ocr_for(cfg), files, audio)
    if grouped is None:
        raise ValueError("batch extraction requires a multi-capable provider (e.g. gemini)")

    created_by = UUID(uploaded_by) if uploaded_by else None
    capture_meta = {"audio_file_id": audio_id} if audio_id else {}

    # 入力(ファイル/ページ)ごとにまとめ、どの入力も最低1件は起こす(抽出ゼロでも未解析で残す)。
    by_file: dict = {}
    for it, f, page in grouped:
        by_file.setdefault(f.id, []).append((it, page))
    for f in files:
        for item, page in by_file.get(f.id) or [(None, None)]:
            await _create_receipt_from_item(
                session,
                firm_id=job.firm_id,
                client_id=job.client_id,
                source=ReceiptSource.mobile.value,
                created_by=created_by,
                capture_meta=capture_meta,
                file=f,
                item=item,
                page=page,
            )


def _resolve_ai(firm_cfg: dict | None, client_cfg: dict | None) -> dict:
    """Resolve AI provider config as client > firm, capability by capability."""
    merged = dict(firm_cfg or {})
    for cap, v in (client_cfg or {}).items():
        if v and v.get("provider"):
            merged[cap] = v
    return merged


async def _process(session, job: Job) -> None:
    firm = await session.get(Firm, job.firm_id)
    if not firm:
        raise ValueError("missing firm for job")

    # Per-client AI config overrides the firm's (client > firm).
    client = await session.get(Client, job.client_id) if job.client_id else None
    cfg = _resolve_ai(firm.ai_config, client.ai_config if client else None)

    # 撮影セット一括: receipt_id を持たず、複数画像+音声から複数 Receipt を起こす別経路。
    if job.kind == "batch":
        await _process_batch(session, job, cfg)
        return

    receipt = await session.get(Receipt, UUID(job.params["receipt_id"]))
    if not receipt:
        raise ValueError("missing receipt for job")

    # "format" ジョブ(メール本文など)はファイルを持たない。
    file_id = job.params.get("file_id")
    file = await session.get(File, UUID(file_id)) if file_id else None

    if job.kind == "ocr":
        if not file:
            raise ValueError("ocr job requires a file")
        # 全経路共通の抽出(extract_batch)。1ファイルから 0..N 件。最初の項目は既存の
        # (プレースホルダ)receipt に、2件目以降は同じファイルを共有する追加 receipt に起こす
        # (複数領収書・カード明細・複数ページPDF 対応)。
        grouped = await _extract_grouped(factory.ocr_for(cfg), [file], None)
        if grouped is None:
            # 設定OCRプロバイダが複数抽出(extract_batch)非対応。本番はGemini前提なので通常起きない
            # (起きたら設定エラーとしてジョブを失敗させ、jobsテーブルで気づけるようにする)。
            raise ValueError("configured OCR provider lacks extract_batch (use gemini)")
        if grouped:
            # 1ファイルから 0..N 件。先頭は既存(プレースホルダ)receiptに、2件目以降は同じファイルを
            # 共有する追加 receipt に起こす(複数領収書・カード明細・複数ページPDF 対応)。
            first, _f, first_page = grouped[0]
            receipt.doc_type = first.doc_type
            if first_page is not None:
                receipt.capture_meta = {**(receipt.capture_meta or {}), "page": first_page}
            receipt.memo = _seed_memo(file, first_page, first.audio_transcript)
            _apply_fields(receipt, first)
            await _autolink_partner(session, receipt)
            _mark_parse_outcome(receipt)
            extra_meta = dict(receipt.capture_meta or {})
            extra_meta.pop("parse_failed", None)
            extra_meta.pop("page", None)  # page は item ごとに設定する
            for item, f, page in grouped[1:]:
                await _create_receipt_from_item(
                    session,
                    firm_id=receipt.firm_id,
                    client_id=receipt.client_id,
                    source=receipt.source,
                    created_by=receipt.created_by,
                    capture_meta=extra_meta,
                    file=f,
                    item=item,
                    page=page,
                )
        else:
            _mark_parse_outcome(receipt)
        return
    elif job.kind == "stt":
        if not file:
            raise ValueError("stt job requires a file")
        data = await run_in_threadpool(storage.get, file.path)
        receipt.stt_raw = await factory.stt_for(cfg).transcribe(data, file.mime)
    elif job.kind == "format":
        pass  # 本文テキストは receipt.ocr_raw に既に入っている。下の整形ステップで処理。
    else:
        raise ValueError(f"unsupported job kind: {job.kind}")

    # Fallback / audio path: structure the raw OCR/STT text with the format provider.
    combined = " ".join(filter(None, [receipt.stt_raw, receipt.ocr_raw])).strip()
    if combined:
        _apply_fields(receipt, await factory.format_for(cfg).to_fields(combined))
    await _autolink_partner(session, receipt)
    _mark_parse_outcome(receipt)


# --- サーキットブレーカ ------------------------------------------------------
# 同一事務所で解析が連続失敗したら一時停止し、無駄なAI呼び出し(トークン)を止める。
# プロセス内メモリで管理(ワーカー再起動でリセット)。失敗=ジョブ例外(タイムアウト/APIエラー等)。
# 「請求書として認識できなかった(parse_failed)」は正常結果なのでカウントしない。
_CIRCUIT_FAIL_THRESHOLD = 5       # 連続失敗がこの回数に達したら停止
_CIRCUIT_PAUSE_SECONDS = 15 * 60  # 停止時間(クールダウン)
_firm_fail_streak: dict = {}
_firm_paused_until: dict = {}


def _paused_firm_ids() -> list:
    """いまクールダウン中の事務所ID一覧(期限切れは掃除)。"""
    now = datetime.now(timezone.utc)
    for fid in [f for f, until in _firm_paused_until.items() if until <= now]:
        _firm_paused_until.pop(fid, None)
    return list(_firm_paused_until.keys())


def _record_job_result(firm_id, ok: bool) -> None:
    """ジョブの成否を事務所ごとの連続失敗カウンタに反映。成功でリセット、閾値超で一時停止。"""
    if ok:
        _firm_fail_streak.pop(firm_id, None)
        _firm_paused_until.pop(firm_id, None)
        return
    n = _firm_fail_streak.get(firm_id, 0) + 1
    _firm_fail_streak[firm_id] = n
    if n >= _CIRCUIT_FAIL_THRESHOLD:
        _firm_paused_until[firm_id] = datetime.now(timezone.utc) + timedelta(seconds=_CIRCUIT_PAUSE_SECONDS)
        logging.getLogger("worker").warning(
            "circuit-breaker: firm %s had %d consecutive failures — pausing AI for %ds",
            firm_id, n, _CIRCUIT_PAUSE_SECONDS,
        )


async def _tick() -> bool:
    async with _Session() as session:
        async with session.begin():
            stmt = select(Job).where(Job.status == "pending")
            paused = _paused_firm_ids()
            if paused:
                # 連続失敗で一時停止中の事務所のジョブは拾わない(無駄トークンを止める)。
                stmt = stmt.where(Job.firm_id.not_in(paused))
            job = await session.scalar(stmt.order_by(Job.created_at).limit(1))
            if not job:
                return False
            try:
                job.status = "processing"
                await _process(session, job)
                # 取込のたびに自動重複(突き合わせ)を再計算 → 重複は自動で除外される。
                if job.client_id:
                    await dedup.recompute_dedup(session, job.client_id)
                job.status = "done"
                job.progress = 100
                _record_job_result(job.firm_id, ok=True)
            except Exception as exc:  # noqa: BLE001 — record and move on
                job.status = "failed"
                # 例外メッセージが空(タイムアウト等)でも種別が残るようにする＋ログにも出す。
                job.error = f"{type(exc).__name__}: {exc}"[:500]
                logging.getLogger("worker").exception(
                    "job %s kind=%s failed: %s", job.id, job.kind, type(exc).__name__
                )
                _record_job_result(job.firm_id, ok=False)
            return True


async def run_worker() -> None:
    while True:
        try:
            worked = await _tick()
        except Exception:  # noqa: BLE001 — never let the loop die
            worked = False
        await asyncio.sleep(0.5 if worked else 3)
