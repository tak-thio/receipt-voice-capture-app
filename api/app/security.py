"""Password hashing, signed web sessions, opaque token hashing, AI-key encryption."""

import hashlib
import secrets

import bcrypt
from cryptography.fernet import Fernet
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import get_settings

settings = get_settings()
_serializer = URLSafeTimedSerializer(settings.session_secret, salt="web-session")
# Distinct salt so an operator cookie can never be replayed as a user cookie
# (or vice versa), even though both are signed with the same secret.
_op_serializer = URLSafeTimedSerializer(settings.session_secret, salt="operator-session")


# --- passwords -------------------------------------------------------------
# bcrypt directly (avoids the passlib<->bcrypt 4.x detection bug). bcrypt only
# uses the first 72 bytes, so truncate explicitly.

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except ValueError:
        return False


# --- web session cookie ----------------------------------------------------

def make_session(user_id: str) -> str:
    return _serializer.dumps({"uid": user_id})


def read_session(token: str, max_age: int = 60 * 60 * 24 * 14) -> str | None:
    try:
        data = _serializer.loads(token, max_age=max_age)
        return data.get("uid")
    except BadSignature:
        return None


# --- operator session cookie (platform 運営) -------------------------------

def make_operator_session(operator_id: str) -> str:
    return _op_serializer.dumps({"oid": operator_id})


def read_operator_session(token: str, max_age: int = 60 * 60 * 24 * 14) -> str | None:
    try:
        data = _op_serializer.loads(token, max_age=max_age)
        return data.get("oid")
    except BadSignature:
        return None


# --- opaque tokens (QR pairing, device refresh) ----------------------------

def new_token() -> str:
    """A high-entropy opaque token to embed in a QR / store on a device."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Store only the hash; compare hashes on redemption."""
    return hashlib.sha256(token.encode()).hexdigest()


# --- per-firm AI key encryption (Fernet) -----------------------------------

def _fernet() -> Fernet:
    key = settings.encryption_key
    if not key:
        raise RuntimeError("ENCRYPTION_KEY is not set")
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
