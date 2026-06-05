from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import auth, captures, clients, export, journal, masters, pairing, receipts

settings = get_settings()

app = FastAPI(title="Receipt SaaS API", version="0.1.0")

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


for r in (auth, pairing, clients, captures, receipts, masters, journal, export):
    app.include_router(r.router)
