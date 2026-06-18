import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from . import storage
from .config import get_settings
from .worker import run_gmail_poller, run_worker
from .routers import (
    auth,
    captures,
    clients,
    export,
    files,
    firm,
    gmail,
    invites,
    journal,
    masters,
    members,
    operator,
    pairing,
    receipts,
    reconcile,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await run_in_threadpool(storage.ensure_bucket)
    except Exception as exc:  # storage may not be ready yet; don't block startup
        print(f"[startup] object storage not ready: {exc}")
    worker = asyncio.create_task(run_worker())
    poller = asyncio.create_task(run_gmail_poller())  # 連携メールの定期取り込み(Cron相当)
    try:
        yield
    finally:
        worker.cancel()
        poller.cancel()


app = FastAPI(title="Receipt SaaS API", version="0.1.0", lifespan=lifespan)

# モバイル(Tauri)アプリは別オリジン(tauri://localhost / http(s)://tauri.localhost)から
# fetch するため CORS が必要。WebUIは同一オリジンなのでこの設定の影響を受けない。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^(tauri|https?)://(tauri\.)?localhost$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


for r in (
    auth, operator, pairing, invites, firm, members, clients,
    captures, receipts, masters, journal, export, files, gmail, reconcile,
):
    app.include_router(r.router)
