"""Background AI worker: consume `jobs` and fill receipt fields.

Runs in-process (started from the app lifespan). It is trusted system code that
processes the queue across firms, so it uses the OWNER connection (RLS-bypass)
and scopes every query explicitly by the job's firm/client. Each job runs the
firm's configured provider (firms.ai_config) for STT / OCR, then the `format`
step to extract structured fields.
"""

import asyncio
import json
from datetime import date, datetime, time, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from . import journaling, storage
from .ai import factory
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


async def _autolink_partner(session, receipt: Receipt) -> None:
    """OCR後、取引先が未設定なら完全一致だけで自動引当する（推測はしない）。"""
    if receipt.partner_id is None:
        receipt.partner_id = await journaling.exact_partner_id(session, receipt)


async def _process_batch(session, job: Job, cfg: dict) -> None:
    """撮影セット一括: 複数画像 + 任意の音声を1回のマルチモーダル呼び出しで解析し、
    含まれる領収書/カード明細行をすべて Receipt として起こす。1画像から複数件が
    出る場合(複数領収書・明細の各行)は同じ画像ファイルを共有する。STT は介さない。"""
    image_ids = job.params.get("image_file_ids") or []
    audio_id = job.params.get("audio_file_id")
    uploaded_by = job.params.get("uploaded_by")
    if not image_ids:
        raise ValueError("batch job requires image_file_ids")

    image_files: list[File] = []
    for fid in image_ids:
        f = await session.get(File, UUID(fid))
        if f:
            image_files.append(f)
    if not image_files:
        raise ValueError("batch job: no image files found")

    images: list[tuple[bytes, str]] = []
    for f in image_files:
        data = await run_in_threadpool(storage.get, f.path)
        images.append((data, f.mime or "image/jpeg"))

    audio_bytes: bytes | None = None
    audio_mime = ""
    audio_file = await session.get(File, UUID(audio_id)) if audio_id else None
    if audio_file:
        audio_bytes = await run_in_threadpool(storage.get, audio_file.path)
        audio_mime = audio_file.mime or "audio/mp4"

    items = await factory.ocr_for(cfg).extract_batch(images, audio_bytes, audio_mime)
    if items is None:
        raise ValueError(
            "batch extraction requires a multi-image/audio capable provider (e.g. gemini)"
        )

    # 画像番号ごとにグルーピング。範囲外の index は先頭画像に寄せる。
    by_image: dict[int, list] = {}
    for it in items:
        idx = it.image_index if 0 <= it.image_index < len(image_files) else 0
        by_image.setdefault(idx, []).append(it)

    created_by = UUID(uploaded_by) if uploaded_by else None
    capture_meta = {"audio_file_id": audio_id} if audio_id else {}

    # どの画像も最低1件は起こす(抽出ゼロでも握りつぶさず未解析で残す)。
    for i, f in enumerate(image_files):
        entries = by_image.get(i) or [None]
        for entry in entries:
            receipt = Receipt(
                firm_id=job.firm_id,
                client_id=job.client_id,
                source=ReceiptSource.mobile.value,
                doc_type=(entry.doc_type if entry else "receipt"),
                vendor=UNPARSED_VENDOR,
                capture_meta=dict(capture_meta),
                created_by=created_by,
            )
            session.add(receipt)
            await session.flush()
            session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="capture"))
            if entry is not None:
                _apply_fields(receipt, entry)
                await _autolink_partner(session, receipt)


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
        data = await run_in_threadpool(storage.get, file.path)
        ocr = factory.ocr_for(cfg)
        # Vision LLMs (Gemini / OpenAI) read the image AND return structured fields
        # in ONE call — apply them and skip the separate text→fields format step.
        fields = await ocr.extract_fields(data, file.mime)
        if fields is not None:
            receipt.ocr_raw = json.dumps(fields.raw, ensure_ascii=False) if fields.raw else None
            _apply_fields(receipt, fields)
            await _autolink_partner(session, receipt)
            return
        receipt.ocr_raw = await ocr.extract_text(data, file.mime)
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


async def _tick() -> bool:
    async with _Session() as session:
        async with session.begin():
            job = await session.scalar(
                select(Job).where(Job.status == "pending").order_by(Job.created_at).limit(1)
            )
            if not job:
                return False
            try:
                job.status = "processing"
                await _process(session, job)
                job.status = "done"
                job.progress = 100
            except Exception as exc:  # noqa: BLE001 — record and move on
                job.status = "failed"
                job.error = str(exc)[:500]
            return True


async def run_worker() -> None:
    while True:
        try:
            worked = await _tick()
        except Exception:  # noqa: BLE001 — never let the loop die
            worked = False
        await asyncio.sleep(0.5 if worked else 3)
