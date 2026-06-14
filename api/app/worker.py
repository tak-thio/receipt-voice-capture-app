"""Background AI worker: consume `jobs` and fill receipt fields.

Runs in-process (started from the app lifespan). It is trusted system code that
processes the queue across firms, so it uses the OWNER connection (RLS-bypass)
and scopes every query explicitly by the job's firm/client. Each job runs the
firm's configured provider (firms.ai_config) for STT / OCR, then the `format`
step to extract structured fields.
"""

import asyncio
import json
from datetime import date, datetime, time, timedelta, timezone
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


async def _image_bytes(session, receipt: Receipt) -> tuple[bytes, str] | None:
    """そのレシートの撮影画像(capture)を1枚返す。なければ None。"""
    rf = await session.scalar(
        select(ReceiptFile).where(
            ReceiptFile.receipt_id == receipt.id, ReceiptFile.kind == "capture"
        )
    )
    if not rf:
        return None
    file = await session.get(File, rf.file_id)
    if not file:
        return None
    data = await run_in_threadpool(storage.get, file.path)
    return data, file.mime or "image/jpeg"


async def _process_voice_session(session, job: Job, cfg: dict) -> None:
    """音声セッション: 録音1本 + その時間帯に撮った写真群を、まとめて
    マルチモーダルモデル(Gemini)へ渡し、各写真の摘要を生成して反映する。
    終わったら音声だけのレシート(置き場)は削除する。STT は介さない。"""
    audio_file = await session.get(File, UUID(job.params["file_id"]))
    audio_receipt = await session.get(Receipt, UUID(job.params["receipt_id"]))
    if not (audio_file and audio_receipt):
        raise ValueError("voice_session job: missing audio file/receipt")

    meta = audio_receipt.capture_meta or {}
    start_ms = meta.get("audio_started_at_ms")
    end_ms = meta.get("audio_ended_at_ms")
    if start_ms is None or end_ms is None:
        raise ValueError("voice_session job: audio window (start/end ms) missing")

    # 候補は同一顧問先のモバイル写真で、音声受信の前後1時間に作られたもの(走査範囲の限定)。
    # 確定条件は capture_meta.captured_at_ms が音声区間内にあること(下で判定)。
    window = timedelta(hours=1)
    candidates = (
        await session.scalars(
            select(Receipt).where(
                Receipt.client_id == audio_receipt.client_id,
                Receipt.source == ReceiptSource.mobile.value,
                Receipt.id != audio_receipt.id,
                Receipt.created_at >= audio_receipt.created_at - window,
                Receipt.created_at <= audio_receipt.created_at + window,
            )
        )
    ).all()

    def captured_ms(r: Receipt):
        cm = r.capture_meta or {}
        if cm.get("voice_session"):
            return None  # 他のセッション音声は対象外
        return cm.get("captured_at_ms")

    photos = [
        r
        for r in candidates
        if (ts := captured_ms(r)) is not None and start_ms <= ts <= end_ms
    ]
    photos.sort(key=lambda r: r.capture_meta["captured_at_ms"])
    if not photos:
        return  # 紐付け対象なし。音声レシートは消さず残す(データを失わない)。

    images: list[tuple[bytes, str]] = []
    matched: list[Receipt] = []
    for r in photos:
        img = await _image_bytes(session, r)
        if img is not None:
            images.append(img)
            matched.append(r)
    if not images:
        return

    audio_bytes = await run_in_threadpool(storage.get, audio_file.path)
    descriptions = await factory.ocr_for(cfg).annotate_session(
        images, audio_bytes, audio_file.mime or "audio/mp4"
    )
    if descriptions is None:
        raise ValueError(
            "voice_session requires an audio-capable multimodal OCR provider (e.g. gemini)"
        )

    # 音声由来の摘要で上書き(セッション直後なので人手編集はまだ無い)。
    for receipt, desc in zip(matched, descriptions):
        text = desc.strip()
        if text:
            receipt.description = text

    # 役目を終えた音声レシート(画像なしの置き場)は削除。ReceiptFile は cascade。
    await session.delete(audio_receipt)


def _resolve_ai(firm_cfg: dict | None, client_cfg: dict | None) -> dict:
    """Resolve AI provider config as client > firm, capability by capability."""
    merged = dict(firm_cfg or {})
    for cap, v in (client_cfg or {}).items():
        if v and v.get("provider"):
            merged[cap] = v
    return merged


async def _process(session, job: Job) -> None:
    firm = await session.get(Firm, job.firm_id)
    receipt = await session.get(Receipt, UUID(job.params["receipt_id"]))
    if not (firm and receipt):
        raise ValueError("missing firm/receipt for job")

    # Per-client AI config overrides the firm's (client > firm).
    client = await session.get(Client, job.client_id) if job.client_id else None
    cfg = _resolve_ai(firm.ai_config, client.ai_config if client else None)

    # 音声セッション: 1本の音声 + 同時間帯の写真群 をまとめて処理する別経路。
    if job.kind == "voice_session":
        await _process_voice_session(session, job, cfg)
        return

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
