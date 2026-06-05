"""Download a stored file (image/audio/pdf). RLS-scoped via the File row."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from .. import storage
from ..db import get_session
from ..deps import Principal, get_principal
from ..models import File

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{file_id}")
async def get_file(
    file_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    f = await session.get(File, file_id)  # RLS: only files in the principal's tenants
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    data = await run_in_threadpool(storage.get, f.path)
    return Response(content=data, media_type=f.mime or "application/octet-stream")
