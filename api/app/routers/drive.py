"""個人(アプリのみ)のデータを本人の Google Drive へエクスポートする。

Gmail OAuth と同じ基盤を流用するが、モバイル起点フロー: アプリが /drive/connect を叩いて
Google 同意URLを受け取り、外部ブラウザで開く → 同意 → /drive/oauth/callback。callback は
ブラウザ(アプリ認証なし)なので、署名付き state(uid/fid) で本人を識別してトークンを保存する。
その後 /drive/export がサーバ上の領収書を本人の Drive へ書き出す(大容量がスマホを経由しない)。

スコープは drive.file(アプリが作成したファイルのみ。Google審査不要)。
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import Principal, get_principal
from ..models import ApprovalStatus, DriveConnection, Receipt
from ..security import decrypt_secret, encrypt_secret, make_oauth_state, read_oauth_state

settings = get_settings()
router = APIRouter(prefix="/drive", tags=["drive"])

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
_FOLDER_NAME = "領収ボックス"
_DONE_HTML = "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;text-align:center;padding:48px'>" \
    "<h2>{msg}</h2><p>アプリに戻ってください。</p></body>"


def _flow():
    from google_auth_oauthlib.flow import Flow

    if not (settings.google_client_id and settings.google_client_secret and settings.drive_oauth_redirect_uri):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Drive OAuth is not configured on this server")
    return Flow.from_client_config(
        {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=DRIVE_SCOPES,
        redirect_uri=settings.drive_oauth_redirect_uri,
        autogenerate_code_verifier=False,  # connect/callback で別 Flow のため(gmail と同様)
    )


@router.get("/connect")
async def connect(principal: Principal = Depends(get_principal)):
    """Drive 連携開始。Google 同意URLを返す(アプリが外部ブラウザで開く)。state に uid/fid を載せる。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")
    flow = _flow()
    state = make_oauth_state({"uid": str(principal.user.id), "fid": str(firm_id)})
    auth_url, _ = flow.authorization_url(
        access_type="offline", prompt="consent", include_granted_scopes="true", state=state
    )
    return {"auth_url": auth_url}


@router.get("/oauth/callback")
async def callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """ブラウザからの戻り。state(署名)で本人を識別し、Drive トークンを firm 単位で暗号化保存する。"""
    data = read_oauth_state(state)
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired oauth state")
    uid, fid = UUID(data["uid"]), UUID(data["fid"])
    if error or not code:
        return HTMLResponse(_DONE_HTML.format(msg="連携をキャンセルしました"))

    flow = _flow()
    await run_in_threadpool(lambda: flow.fetch_token(code=code))
    creds = flow.credentials

    await set_rls_context(session, uid)  # principal が無いので state の uid で RLS を張る
    conn = await session.scalar(select(DriveConnection).where(DriveConnection.firm_id == fid))
    if conn is None:
        conn = DriveConnection(firm_id=fid, connected_by=uid)
        session.add(conn)
    conn.access_token_enc = encrypt_secret(creds.token) if creds.token else None
    if creds.refresh_token:  # 再同意時は省かれることがある。来た時だけ更新。
        conn.refresh_token_enc = encrypt_secret(creds.refresh_token)
    conn.scopes = " ".join(creds.scopes or [])
    conn.token_expires_at = creds.expiry.replace(tzinfo=timezone.utc) if creds.expiry else None
    conn.active = True
    await session.flush()
    return HTMLResponse(_DONE_HTML.format(msg="Google ドライブと連携しました"))


@router.get("/status")
async def drive_status(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """連携済みか(アプリの表示出し分け用)。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    conn = await session.scalar(select(DriveConnection).where(DriveConnection.firm_id == firm_id)) if firm_id else None
    return {"connected": bool(conn and conn.refresh_token_enc and conn.active)}


def _build_csv(rows: list[Receipt]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["日付", "支払先", "金額(税込)", "税抜", "消費税", "税区分", "支払方法", "インボイス番号", "摘要", "メモ", "取込元"])
    for r in rows:
        w.writerow([
            r.captured_at.date().isoformat() if r.captured_at else "",
            r.vendor or "",
            r.amount_jpy if r.amount_jpy is not None else "",
            r.subtotal_jpy if r.subtotal_jpy is not None else "",
            r.tax_jpy if r.tax_jpy is not None else "",
            r.tax_mode or "",
            r.payment_method or "",
            r.t_number or "",
            r.description or "",
            r.memo or "",
            r.source or "",
        ])
    return buf.getvalue().encode("utf-8-sig")  # Excel で文字化けしないよう BOM 付き


def _upload_csv(refresh_token: str, access_token: str | None, data: bytes, filename: str) -> dict:
    """同期(ブロッキング)。Drive にフォルダを用意し CSV をアップロードして webViewLink を返す。"""
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaInMemoryUpload

    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=DRIVE_SCOPES,
    )
    if not creds.valid:
        creds.refresh(GoogleRequest())
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    found = svc.files().list(
        q=f"mimeType='application/vnd.google-apps.folder' and name='{_FOLDER_NAME}' and trashed=false",
        spaces="drive", fields="files(id)",
    ).execute().get("files", [])
    folder_id = found[0]["id"] if found else svc.files().create(
        body={"name": _FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}, fields="id",
    ).execute()["id"]
    f = svc.files().create(
        body={"name": filename, "parents": [folder_id]},
        media_body=MediaInMemoryUpload(data, mimetype="text/csv"),
        fields="id,webViewLink",
    ).execute()
    return {"link": f.get("webViewLink")}


@router.post("/export")
async def export(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """個人の全領収書を CSV にして本人の Google Drive(領収ボックス フォルダ)へ書き出す。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    if not firm_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "アカウントがありません")
    conn = await session.scalar(select(DriveConnection).where(DriveConnection.firm_id == firm_id))
    if not conn or not conn.refresh_token_enc:
        raise HTTPException(status.HTTP_409_CONFLICT, "先に Google ドライブと連携してください")
    rows = list(
        await session.scalars(
            select(Receipt)
            .where(
                Receipt.firm_id == firm_id,
                Receipt.doc_type == "receipt",
                Receipt.approval_status != ApprovalStatus.deleted.value,
            )
            .order_by(Receipt.captured_at)
        )
    )
    data = _build_csv(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    refresh = decrypt_secret(conn.refresh_token_enc)
    access = decrypt_secret(conn.access_token_enc) if conn.access_token_enc else None
    try:
        result = await run_in_threadpool(_upload_csv, refresh, access, data, f"領収書_{stamp}.csv")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Google ドライブへの書き出しに失敗しました")
    return {"count": len(rows), "link": result.get("link")}
