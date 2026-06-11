"""Download a stored file (image/audio/pdf) and render PDF previews.

RLS-scoped via the File row.
"""

from uuid import UUID

import fitz  # PyMuPDF
from botocore.exceptions import ClientError
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


def _render_pdf_preview(data: bytes) -> bytes:
    """First page of a PDF -> PNG bytes (for an inline, easy-to-read preview)."""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pix = doc.load_page(0).get_pixmap(dpi=150)
        return pix.tobytes("png")
    finally:
        doc.close()


@router.get("/{file_id}/preview")
async def get_file_preview(
    file_id: UUID,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """A renderable image for the file: images pass through; PDFs are rendered to
    a PNG of the first page (cached in storage as `<path>.preview.png`)."""
    f = await session.get(File, file_id)  # RLS-scoped
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")

    mime = (f.mime or "").lower()
    if mime.startswith("image/"):
        data = await run_in_threadpool(storage.get, f.path)
        return Response(content=data, media_type=mime)

    if "pdf" in mime or f.kind == "pdf":
        preview_key = f"{f.path}.preview.png"
        try:
            png = await run_in_threadpool(storage.get, preview_key)
        except ClientError:
            src = await run_in_threadpool(storage.get, f.path)
            png = await run_in_threadpool(_render_pdf_preview, src)
            await run_in_threadpool(storage.put, preview_key, png, "image/png")
        return Response(content=png, media_type="image/png")

    # Other types: just return the original bytes.
    data = await run_in_threadpool(storage.get, f.path)
    return Response(content=data, media_type=f.mime or "application/octet-stream")
