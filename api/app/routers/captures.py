"""Mobile capture intake: image (+ optional audio) -> receipt + AI jobs.

Auth: a paired device (Bearer device token); principal.device_client_id is the
顧問先 the device belongs to. Tenant isolation on insert is enforced by RLS.
"""

import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import storage
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import UNPARSED_VENDOR, Client, File, Job, Receipt, ReceiptFile, ReceiptSource

router = APIRouter(prefix="/captures", tags=["captures"])


async def _store_file(session, firm_id, client_id, upload: UploadFile, kind: str, uploaded_by):
    data = await upload.read()
    sha = hashlib.sha256(data).hexdigest()
    path = f"{firm_id}/{client_id}/{sha}"
    await run_in_threadpool(storage.put, path, data, upload.content_type or "application/octet-stream")
    f = File(
        firm_id=firm_id,
        client_id=client_id,
        sha256=sha,
        kind=kind,
        path=path,
        size=len(data),
        mime=upload.content_type or "",
        uploaded_by=uploaded_by,
    )
    session.add(f)
    await session.flush()
    return f


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_capture(
    image: UploadFile | None = None,
    audio: UploadFile | None = None,
    captured_at: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    client_id = principal.device_client_id
    if not client_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a paired device")
    client = await session.get(Client, client_id)
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")

    # 端末のキャプチャ時メタデータ(JSON)。壊れていても取り込みは止めない。
    capture_meta: dict = {}
    if metadata:
        try:
            parsed = json.loads(metadata)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            capture_meta = parsed

    receipt = Receipt(
        firm_id=client.firm_id,
        client_id=client.id,
        source=ReceiptSource.mobile.value,
        captured_at=datetime.fromisoformat(captured_at) if captured_at else None,
        capture_meta=capture_meta,
        created_by=principal.user.id,
    )
    session.add(receipt)
    await session.flush()

    if image is not None:
        f = await _store_file(session, client.firm_id, client.id, image, "image", principal.user.id)
        session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="capture"))
        session.add(Job(firm_id=client.firm_id, client_id=client.id, kind="ocr",
                        params={"receipt_id": str(receipt.id), "file_id": str(f.id)}))
    if audio is not None:
        f = await _store_file(session, client.firm_id, client.id, audio, "audio", principal.user.id)
        session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="audio"))
        # セッション音声(連続撮影中に録った1本)は、画像が無くても voice_session で処理:
        # 同時間帯の写真群と一緒にマルチモーダルへ渡し、各写真の摘要を生成する。
        # それ以外(手動で1枚に添付した音声)は従来どおり stt。
        kind = "voice_session" if capture_meta.get("voice_session") else "stt"
        session.add(Job(firm_id=client.firm_id, client_id=client.id, kind=kind,
                        params={"receipt_id": str(receipt.id), "file_id": str(f.id)}))

    # TODO(Phase 1): a worker consumes the stt/ocr/format/voice_session jobs using
    # ai.factory providers (the firm's ai_config) and fills the receipt fields.
    return {"receipt_id": str(receipt.id), "status": "queued"}


@router.post("/web", status_code=status.HTTP_201_CREATED)
async def create_web_capture(
    client_id: str = Form(...),
    image: UploadFile | None = None,
    audio: UploadFile | None = None,
    captured_at: str | None = Form(default=None),
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """Web upload: a logged-in user (事務所職員 or 顧客) adds a receipt
    (image/PDF [+ optional audio]) to a client they can access.

    Unlike POST /captures (paired device only), the target client is given
    explicitly. RLS authorizes: session.get(Client) returns None if the
    principal has no access to that client, and the Receipt INSERT WITH CHECK
    enforces the same on write.
    """
    client = await session.get(Client, UUID(client_id))
    if not client:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no access to this client")
    if image is None and audio is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "image or audio required")

    receipt = Receipt(
        firm_id=client.firm_id,
        client_id=client.id,
        source=ReceiptSource.manual.value,
        # Upload-time defaults: date = today, vendor = 未解析 placeholder. The worker
        # replaces the vendor once OCR/format parses the uploaded image.
        captured_at=datetime.fromisoformat(captured_at) if captured_at else datetime.now(timezone.utc),
        vendor=UNPARSED_VENDOR,
        created_by=principal.user.id,
    )
    session.add(receipt)
    await session.flush()

    if image is not None:
        kind = "pdf" if (image.content_type or "").endswith("pdf") else "image"
        f = await _store_file(session, client.firm_id, client.id, image, kind, principal.user.id)
        session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="capture"))
        session.add(Job(firm_id=client.firm_id, client_id=client.id, kind="ocr",
                        params={"receipt_id": str(receipt.id), "file_id": str(f.id)}))
    if audio is not None:
        f = await _store_file(session, client.firm_id, client.id, audio, "audio", principal.user.id)
        session.add(ReceiptFile(receipt_id=receipt.id, file_id=f.id, kind="audio"))
        session.add(Job(firm_id=client.firm_id, client_id=client.id, kind="stt",
                        params={"receipt_id": str(receipt.id), "file_id": str(f.id)}))

    return {"receipt_id": str(receipt.id), "status": "queued"}
