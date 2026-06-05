"""Background AI worker: consume `jobs` and fill receipt fields.

Runs in-process (started from the app lifespan). It is trusted system code that
processes the queue across firms, so it uses the OWNER connection (RLS-bypass)
and scopes every query explicitly by the job's firm/client. Each job runs the
firm's configured provider (firms.ai_config) for STT / OCR, then the `format`
step to extract structured fields.
"""

import asyncio
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.concurrency import run_in_threadpool

from . import storage
from .ai import factory
from .config import get_settings
from .models import File, Firm, Job, Receipt

settings = get_settings()
# Owner engine — trusted worker, bypasses RLS (scopes by job.firm_id/client_id).
_engine = create_async_engine(settings.database_url, pool_pre_ping=True)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


async def _process(session, job: Job) -> None:
    firm = await session.get(Firm, job.firm_id)
    receipt = await session.get(Receipt, UUID(job.params["receipt_id"]))
    file = await session.get(File, UUID(job.params["file_id"]))
    if not (firm and receipt and file):
        raise ValueError("missing firm/receipt/file for job")

    data = await run_in_threadpool(storage.get, file.path)

    if job.kind == "ocr":
        receipt.ocr_raw = await factory.ocr_for(firm.ai_config).extract_text(data, file.mime)
    elif job.kind == "stt":
        receipt.stt_raw = await factory.stt_for(firm.ai_config).transcribe(data, file.mime)
    else:
        raise ValueError(f"unsupported job kind: {job.kind}")

    # Format step: turn the raw text into structured fields (don't overwrite
    # values a human may have already entered).
    combined = " ".join(filter(None, [receipt.stt_raw, receipt.ocr_raw])).strip()
    if combined:
        fields = await factory.format_for(firm.ai_config).to_fields(combined)
        receipt.vendor = receipt.vendor or fields.vendor
        receipt.amount_jpy = receipt.amount_jpy or fields.amount_jpy
        receipt.tax_mode = receipt.tax_mode or fields.tax_mode
        receipt.payment_method = receipt.payment_method or fields.payment_method
        receipt.t_number = receipt.t_number or fields.t_number


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
