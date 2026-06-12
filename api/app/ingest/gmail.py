"""Gmail API thin wrapper — list message ids matching a query and fetch a
message (subject/from/body/attachments). Ported from receipt-app and broadened
to capture image attachments as well as PDFs.
"""
from __future__ import annotations

import base64
from collections.abc import Iterator
from dataclasses import dataclass, field
from email.utils import getaddresses

import httplib2
from google_auth_httplib2 import AuthorizedHttp
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

_HTTP_TIMEOUT_S = 60
# 添付として領収書化する MIME / 拡張子。
_ATTACH_MIME = ("application/pdf",)
_ATTACH_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif")


@dataclass
class Attachment:
    filename: str
    mime_type: str
    data: bytes


@dataclass
class GmailMsg:
    id: str
    subject: str
    from_addr: str
    internal_date_ms: int
    body_text: str
    body_html: str
    message_id: str = ""
    attachments: list[Attachment] = field(default_factory=list)


def _build_query(after: str, before: str, query: str) -> str:
    parts = [f"after:{after}", f"before:{before}"]
    if query:
        parts.append(f"({query})")
    return " ".join(parts)


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")


def _walk(payload: dict) -> Iterator[dict]:
    yield payload
    for part in payload.get("parts", []) or []:
        yield from _walk(part)


def _header(headers: list[dict], name: str) -> str:
    nl = name.lower()
    for h in headers:
        if h.get("name", "").lower() == nl:
            return h.get("value", "")
    return ""


def _is_receipt_attachment(filename: str, mime: str) -> bool:
    if mime in _ATTACH_MIME or mime.startswith("image/"):
        return True
    return bool(filename) and filename.lower().endswith(_ATTACH_EXT)


class GmailClient:
    def __init__(self, credentials):
        authed = AuthorizedHttp(credentials, http=httplib2.Http(timeout=_HTTP_TIMEOUT_S))
        self.service = build("gmail", "v1", http=authed, cache_discovery=False)

    def search_message_ids(self, *, after: str, before: str, query: str) -> list[str]:
        q = _build_query(after, before, query)
        ids: list[str] = []
        page_token: str | None = None
        while True:
            try:
                resp = (
                    self.service.users().messages()
                    .list(userId="me", q=q, pageToken=page_token, maxResults=200)
                    .execute()
                )
            except HttpError as e:
                raise RuntimeError(f"Gmail search failed: {e}") from e
            ids.extend(m["id"] for m in resp.get("messages", []) or [])
            page_token = resp.get("nextPageToken")
            if not page_token:
                return ids

    def fetch_message(self, msg_id: str) -> GmailMsg:
        msg = self.service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        payload = msg.get("payload", {}) or {}
        headers = payload.get("headers", []) or []
        text_chunks: list[str] = []
        html_chunks: list[str] = []
        attachments: list[Attachment] = []
        for part in _walk(payload):
            mime = part.get("mimeType", "")
            body = part.get("body", {}) or {}
            filename = part.get("filename", "")
            if filename and _is_receipt_attachment(filename, mime):
                data_b64 = body.get("data")
                if not data_b64 and body.get("attachmentId"):
                    att = (
                        self.service.users().messages().attachments()
                        .get(userId="me", messageId=msg_id, id=body["attachmentId"]).execute()
                    )
                    data_b64 = att.get("data", "")
                if data_b64:
                    attachments.append(Attachment(
                        filename=filename,
                        mime_type=mime or "application/octet-stream",
                        data=base64.urlsafe_b64decode(data_b64.encode("utf-8")),
                    ))
                continue
            if mime == "text/plain" and body.get("data"):
                text_chunks.append(_decode(body["data"]))
            elif mime == "text/html" and body.get("data"):
                html_chunks.append(_decode(body["data"]))
        return GmailMsg(
            id=msg["id"],
            subject=_header(headers, "Subject"),
            from_addr=_header(headers, "From"),
            internal_date_ms=int(msg.get("internalDate", "0")),
            body_text="\n".join(text_chunks),
            body_html="\n".join(html_chunks),
            message_id=_header(headers, "Message-ID").strip(),
            attachments=attachments,
        )

    def profile_email(self) -> str:
        prof = self.service.users().getProfile(userId="me").execute()
        return (prof.get("emailAddress") or "").lower()
