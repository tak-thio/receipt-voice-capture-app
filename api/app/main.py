import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from . import storage
from .config import get_settings
from .worker import run_worker
from .routers import (
    auth,
    captures,
    clients,
    export,
    files,
    firm,
    invites,
    journal,
    masters,
    members,
    pairing,
    receipts,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await run_in_threadpool(storage.ensure_bucket)
    except Exception as exc:  # storage may not be ready yet; don't block startup
        print(f"[startup] object storage not ready: {exc}")
    worker = asyncio.create_task(run_worker())
    try:
        yield
    finally:
        worker.cancel()


app = FastAPI(title="Receipt SaaS API", version="0.1.0", lifespan=lifespan)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/health")
async def health():
    return {"ok": True}


for r in (
    auth, pairing, invites, firm, members, clients,
    captures, receipts, masters, journal, export, files,
):
    app.include_router(r.router)
