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
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session, set_rls_context
from ..deps import Principal, get_principal
from ..models import Client, DeviceSession, Firm, Membership, Role, User
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
    }


async def _mint(session: AsyncSession, user_id: UUID, client_id: UUID) -> str:
    token = new_token()
    session.add(DeviceSession(user_id=user_id, client_id=client_id, refresh_token_hash=hash_token(token)))
    await session.flush()
    return token


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
    # プラットフォームのAI設定(Gemini)を継承 → 個人でも解析できる。
    ai_config: dict = {}
    if settings.platform_ai_firm_id:
        ref = await session.get(Firm, UUID(settings.platform_ai_firm_id))
        if ref:
            ai_config = dict(ref.ai_config or {})

    firm = Firm(name=name, plan="free", ai_config=ai_config)
    user = User(email=email, name=name, password_hash=hash_password(body.password))
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
    return _payload(token, user, client, firm)


@router.post("/login")
async def login(body: LoginBody, session: AsyncSession = Depends(get_session)):
    email = body.email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "メールアドレスまたはパスワードが違います")
    firm = (
        await session.execute(
            select(Firm)
            .join(Membership, Membership.firm_id == Firm.id)
            .where(Membership.user_id == user.id, Firm.plan.in_(_PERSONAL_PLANS))
            .limit(1)
        )
    ).scalars().first()
    if not firm:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "個人アカウントが見つかりません")
    await set_rls_context(session, user.id)
    client = (await session.execute(select(Client).where(Client.firm_id == firm.id).limit(1))).scalars().first()
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "アカウントの初期化に失敗しています")
    token = await _mint(session, user.id, client.id)
    return _payload(token, user, client, firm)


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
    # firm 削除で client→receipts→files・memberships・device_sessions が DB の CASCADE で消える。
    await session.execute(delete(Firm).where(Firm.id == firm.id))
    await session.execute(delete(User).where(User.id == principal.user.id))
    await session.flush()
