"""Background AI worker: consume `jobs` and fill receipt fields.

Runs in-process (started from the app lifespan). It is trusted system code that
processes the queue across firms, so it uses the OWNER connection (RLS-bypass)
and scopes every query explicitly by the job's firm/client. Each job runs the
firm's configured provider (firms.ai_config) for STT / OCR, then the `format`
step to extract structured fields.
"""

import asyncio
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from . import storage
from .ai import factory
from .config import get_settings
from .models import UNPARSED_VENDOR, Client, File, Firm, Job, Receipt

settings = get_settings()
# Owner engine — trusted worker, bypasses RLS (scopes by job.firm_id/client_id).
_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


def _apply_fields(receipt: Receipt, fields) -> None:
    """Fill receipt fields from an extraction. Replaces the 未解析 upload placeholder
    but never clobbers a value a human already entered."""
    if receipt.vendor == UNPARSED_VENDOR and fields.vendor:
        receipt.vendor = fields.vendor
    else:
        receipt.vendor = receipt.vendor or fields.vendor
    receipt.amount_jpy = receipt.amount_jpy or fields.amount_jpy
    receipt.subtotal_jpy = receipt.subtotal_jpy or fields.subtotal_jpy
    receipt.tax_jpy = receipt.tax_jpy or fields.tax_jpy
    receipt.tax_10_jpy = receipt.tax_10_jpy or fields.tax_10_jpy
    receipt.tax_8_jpy = receipt.tax_8_jpy or fields.tax_8_jpy
    receipt.tax_mode = receipt.tax_mode or fields.tax_mode
    receipt.payment_method = receipt.payment_method or fields.payment_method
    receipt.t_number = receipt.t_number or fields.t_number


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
    file = await session.get(File, UUID(job.params["file_id"]))
    if not (firm and receipt and file):
        raise ValueError("missing firm/receipt/file for job")

    # Per-client AI config overrides the firm's (client > firm).
    client = await session.get(Client, job.client_id) if job.client_id else None
    cfg = _resolve_ai(firm.ai_config, client.ai_config if client else None)

    data = await run_in_threadpool(storage.get, file.path)

    if job.kind == "ocr":
        ocr = factory.ocr_for(cfg)
        # Vision LLMs (Gemini / OpenAI) read the image AND return structured fields
        # in ONE call — apply them and skip the separate text→fields format step.
        fields = await ocr.extract_fields(data, file.mime)
        if fields is not None:
            receipt.ocr_raw = json.dumps(fields.raw, ensure_ascii=False) if fields.raw else None
            _apply_fields(receipt, fields)
            return
        receipt.ocr_raw = await ocr.extract_text(data, file.mime)
    elif job.kind == "stt":
        receipt.stt_raw = await factory.stt_for(cfg).transcribe(data, file.mime)
    else:
        raise ValueError(f"unsupported job kind: {job.kind}")

    # Fallback / audio path: structure the raw OCR/STT text with the format provider.
    combined = " ".join(filter(None, [receipt.stt_raw, receipt.ocr_raw])).strip()
    if combined:
        _apply_fields(receipt, await factory.format_for(cfg).to_fields(combined))


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
