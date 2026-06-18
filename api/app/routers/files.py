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
    page: int = 0,  # >0 かつPDFなら、そのページだけを1ページPDFで返す(添付/個別表示用)
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    f = await session.get(File, file_id)  # RLS: only files in the principal's tenants
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    if page > 0 and ("pdf" in (f.mime or "").lower() or f.kind == "pdf"):
        # 多ページPDFから「そのページだけ」を切り出して返す(原本は page なしで取得できる)。
        key = f"{f.path}.page{page}.pdf"
        try:
            data = await run_in_threadpool(storage.get, key)
        except ClientError:
            src = await run_in_threadpool(storage.get, f.path)
            data = await run_in_threadpool(_extract_pdf_page, src, page)
            await run_in_threadpool(storage.put, key, data, "application/pdf")
        return Response(content=data, media_type="application/pdf")
    data = await run_in_threadpool(storage.get, f.path)
    return Response(content=data, media_type=f.mime or "application/octet-stream")


def _render_pdf_preview(data: bytes, page: int = 1) -> bytes:
    """PDFの指定ページ(1始まり)→ PNG bytes(インラインで読みやすいプレビュー)。"""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        idx = max(0, min(page - 1, doc.page_count - 1))
        pix = doc.load_page(idx).get_pixmap(dpi=150)
        return pix.tobytes("png")
    finally:
        doc.close()


def _extract_pdf_page(data: bytes, page: int) -> bytes:
    """PDFの指定ページ(1始まり)を1ページPDFとして切り出す(再ラスタライズなし=無劣化)。"""
    src = fitz.open(stream=data, filetype="pdf")
    try:
        idx = max(0, min(page - 1, src.page_count - 1))
        one = fitz.open()
        one.insert_pdf(src, from_page=idx, to_page=idx)
        return one.tobytes()
    finally:
        src.close()


@router.get("/{file_id}/preview")
async def get_file_preview(
    file_id: UUID,
    page: int = 1,  # PDFの何ページ目を描画するか(1始まり)。画像では無視。
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """A renderable image for the file: images pass through; PDFs are rendered to a
    PNG of the requested page (1-indexed; cached as `<path>.preview.p{N}.png`)."""
    f = await session.get(File, file_id)  # RLS-scoped
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")

    mime = (f.mime or "").lower()
    if mime.startswith("image/"):
        data = await run_in_threadpool(storage.get, f.path)
        return Response(content=data, media_type=mime)

    if "pdf" in mime or f.kind == "pdf":
        page = max(1, page)
        preview_key = f"{f.path}.preview.p{page}.png"
        try:
            png = await run_in_threadpool(storage.get, preview_key)
        except ClientError:
            src = await run_in_threadpool(storage.get, f.path)
            png = await run_in_threadpool(_render_pdf_preview, src, page)
            await run_in_threadpool(storage.put, preview_key, png, "image/png")
        return Response(content=png, media_type="image/png")

    # Other types: just return the original bytes.
    data = await run_in_threadpool(storage.get, f.path)
    return Response(content=data, media_type=f.mime or "application/octet-stream")
