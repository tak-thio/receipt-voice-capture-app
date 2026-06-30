"""個人プラン(無料/サブスク)の本人サインアップ/ログイン/退会。

事務所連携なしで、サインアップ時に **1人用の firm+client を自動生成**して使う(個人=その firm の
firm_owner)。AI設定はプラットフォーム参照firm(Gemini)を継承。退会はアカウント＋データを削除
(Apple必須要件)。モバイル専用想定で redeem と同じ形(device token)を返す。
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .. import billing
from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import Principal, get_principal
from ..models import Client, DeviceSession, Firm, Membership, Role, Subscription, User
from ..security import hash_password, hash_token, new_token, verify_password
from ..seed import seed_firm_template

router = APIRouter(prefix="/individual", tags=["individual"])
settings = get_settings()
_PERSONAL_PLANS = ("free", "pro")


class SignupBody(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginBody(BaseModel):
    email: str
    password: str


def _payload(token: str, user: User, client: Client, firm: Firm) -> dict:
    return {
        "access_token": token,
        "client_id": str(client.id),
        "user_id": str(user.id),
        "user_name": user.name or "",
        "job_title": "",
        "role": Role.firm_owner.value,
        "client_name": client.name,
        "firm_name": firm.name,
        "individual": True,
        "plan": firm.plan,
        "email": user.email,
    }


async def _mint(session: AsyncSession, user_id: UUID, client_id: UUID) -> str:
    token = new_token()
    session.add(DeviceSession(user_id=user_id, client_id=client_id, refresh_token_hash=hash_token(token)))
    await session.flush()
    return token


async def _provision(
    session: AsyncSession, *, name: str, email: str | None, password_hash: str | None
) -> tuple[str, User, Client, Firm]:
    """1人用の firm+client+user を作成 → 勘定科目テンプレを seed → device token を mint。
    匿名スタート(email/password なし)とメール登録ありの両方で共通に使う。"""
    # プラットフォームのAI設定(Gemini)を継承 → 個人でも解析できる。
    ai_config: dict = {}
    if settings.platform_ai_firm_id:
        ref = await session.get(Firm, UUID(settings.platform_ai_firm_id))
        if ref:
            ai_config = dict(ref.ai_config or {})

    firm = Firm(name=name, plan="free", ai_config=ai_config)
    user = User(email=email, name=name, password_hash=password_hash)
    session.add_all([firm, user])
    await session.flush()
    session.add(Membership(user_id=user.id, firm_id=firm.id, client_id=None, role=Role.firm_owner.value))
    await session.flush()
    # 自分のRLSコンテキストを張ってからテナント行(client/勘定科目)を作る(operator と同じ手順)。
    await set_rls_context(session, user.id)
    client = Client(firm_id=firm.id, name=name)
    session.add(client)
    await session.flush()
    await seed_firm_template(session, firm.id)
    token = await _mint(session, user.id, client.id)
    return token, user, client, firm


@router.post("/start", status_code=status.HTTP_201_CREATED)
async def start(session: AsyncSession = Depends(get_session)):
    """匿名スタート: メール/パスワード無しで1人用アカウントを作り device token を返す。
    すぐ撮影を始められる(価値を先に体験)。後から /individual/claim でメール/パスワードを
    結びつけて、別端末ログイン・購入の復元を可能にする(購入前に claim を必須化する想定)。"""
    token, user, client, firm = await _provision(
        session, name="マイアカウント", email=None, password_hash=None
    )
    return _payload(token, user, client, firm)


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupBody, session: AsyncSession = Depends(get_session)):
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "メールアドレスを入力してください")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "パスワードは8文字以上にしてください")
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "このメールアドレスは既に登録されています")
    name = body.name.strip() or "マイアカウント"
    token, user, client, firm = await _provision(
        session, name=name, email=email, password_hash=hash_password(body.password)
    )
    return _payload(token, user, client, firm)


class ClaimBody(BaseModel):
    email: str
    password: str
    name: str = ""


@router.post("/claim")
async def claim(
    body: ClaimBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """匿名アカウントにメール/パスワードを結びつける(遅延サインアップ)。以後 /individual/login
    で別端末から入れ、購入の復元先になる。既にメール登録済み/他人が使用中のメールは弾く。
    使用中の device token はそのまま有効なので、アプリは token を変えずに email だけ更新すればよい。"""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "メールアドレスを入力してください")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "パスワードは8文字以上にしてください")
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    firm = await session.get(Firm, firm_id) if firm_id else None
    if not firm or firm.plan not in _PERSONAL_PLANS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "このアカウントには登録できません")
    user = await session.get(User, principal.user.id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントが見つかりません")
    if user.email:
        raise HTTPException(status.HTTP_409_CONFLICT, "このアカウントは既にメール登録済みです")
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "このメールアドレスは既に登録されています")
    user.email = email
    user.password_hash = hash_password(body.password)
    if body.name.strip():
        user.name = body.name.strip()
    try:
        await session.flush()
    except IntegrityError:
        # pre-check と flush の間で他者が同じメールを登録した場合の保険(unique 制約)。
        raise HTTPException(status.HTTP_409_CONFLICT, "このメールアドレスは既に登録されています")
    return {"email": user.email, "user_name": user.name or "", "plan": firm.plan, "individual": True}


class ProfileBody(BaseModel):
    name: str


@router.patch("/profile")
async def update_profile(
    body: ProfileBody,
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """個人アカウントの表示名を変更する(匿名/メール登録済みどちらでも可)。"""
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名前を入力してください")
    if len(name) > 50:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "名前は50文字以内で入力してください")
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    firm = await session.get(Firm, firm_id) if firm_id else None
    if not firm or firm.plan not in _PERSONAL_PLANS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "この操作はできません")
    user = await session.get(User, principal.user.id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントが見つかりません")
    user.name = name
    await session.flush()
    return {"user_name": user.name or ""}


@router.post("/login")
async def login(body: LoginBody, session: AsyncSession = Depends(get_session)):
    """メール/パスワードでログイン。所属firmから **個人/会社(顧問先)を自動判定**して接続情報を返す。
    個人(personal firm=free/pro)を優先、無ければ会社の顧問先(client_user)。
    QR連携(pairing/redeem)とは別経路で、どちらでも同じ device token を発行する。"""
    email = body.email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "メールアドレスまたはパスワードが違います")
    if user.status == "disabled":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "このアカウントは無効です")

    # pre-RLS(app_uid NULL の NULL-escape で identity/membership/firm を読む。auth.py と同手順)
    memberships = (
        await session.scalars(select(Membership).where(Membership.user_id == user.id))
    ).all()

    # 1) 個人アカウント(personal firm = free/pro)を優先
    for m in memberships:
        firm = await session.get(Firm, m.firm_id)
        if firm and firm.plan in _PERSONAL_PLANS:
            await set_rls_context(session, user.id)
            client = (
                await session.execute(select(Client).where(Client.firm_id == firm.id).limit(1))
            ).scalars().first()
            if not client:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントの初期化に失敗しています")
            token = await _mint(session, user.id, client.id)
            return _payload(token, user, client, firm)

    # 2) 会社の顧問先(client_id を持つ membership)
    client_m = next((m for m in memberships if m.client_id is not None), None)
    if client_m is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ご利用できるアカウントが見つかりません")
    firm = await session.get(Firm, client_m.firm_id)
    if firm is None or firm.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ご利用できないアカウントです")
    await set_rls_context(session, user.id)
    client = await session.get(Client, client_m.client_id)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントの初期化に失敗しています")
    token = await _mint(session, user.id, client.id)
    return {
        "access_token": token,
        "client_id": str(client.id),
        "user_id": str(user.id),
        "user_name": user.name or "",
        "job_title": user.job_title or "",
        "role": client_m.role,
        "client_name": client.name,
        "firm_name": firm.name,
        "individual": False,
    }


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_session),
):
    """個人アカウントとデータを完全削除(Apple必須)。個人firm(free/pro)のみ許可。"""
    firm_id = principal.memberships[0].firm_id if principal.memberships else None
    firm = await session.get(Firm, firm_id) if firm_id else None
    if not firm or firm.plan not in _PERSONAL_PLANS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "このアカウントは削除できません")
    # 退会後の課金継続を防ぐ: 先に Play 定期購入の自動更新を停止(best-effort。失敗しても退会は続行)。
    subs = (
        await session.scalars(
            select(Subscription).where(
                Subscription.firm_id == firm.id, Subscription.platform == "google"
            )
        )
    ).all()
    for sub in subs:
        await run_in_threadpool(billing.cancel_google_subscription, sub.purchase_token, sub.product_id)
    # firm 削除で client→receipts→files・subscriptions・memberships・device_sessions が CASCADE で消える。
    await session.execute(delete(Firm).where(Firm.id == firm.id))
    await session.execute(delete(User).where(User.id == principal.user.id))
    await session.flush()
