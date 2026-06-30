"""Google Play へ AAB を自動アップロードする(Play Developer Publishing API / edits)。

手動で Play Console にドラッグせず、サービスアカウントでアップロード→トラック割当→公開まで行う。
鍵は $PLAY_SA_KEY(既定 ~/.android-keystores/play-sa.json)。SA に「テストトラックへのリリース」権限が必要。

使い方: python play_upload.py <aab> [track=internal]
"""
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PKG = "com.itsherpa.ffreceipt"


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: play_upload.py <aab> [track=internal]")
    aab = sys.argv[1]
    track = sys.argv[2] if len(sys.argv) > 2 else "internal"
    key = os.path.expanduser(os.environ.get("PLAY_SA_KEY", "~/.android-keystores/play-sa.json"))
    if not os.path.isfile(aab):
        sys.exit(f"AAB not found: {aab}")
    if not os.path.isfile(key):
        sys.exit(f"SA key not found: {key}")

    creds = service_account.Credentials.from_service_account_file(
        key, scopes=["https://www.googleapis.com/auth/androidpublisher"]
    )
    svc = build("androidpublisher", "v3", credentials=creds, cache_discovery=False)

    edit = svc.edits().insert(packageName=PKG, body={}).execute()
    eid = edit["id"]
    media = MediaFileUpload(aab, mimetype="application/octet-stream", resumable=True)
    bundle = svc.edits().bundles().upload(packageName=PKG, editId=eid, media_body=media).execute()
    vc = bundle["versionCode"]
    print(f"uploaded versionCode={vc}")
    svc.edits().tracks().update(
        packageName=PKG,
        editId=eid,
        track=track,
        body={"releases": [{"status": "completed", "versionCodes": [str(vc)]}]},
    ).execute()
    svc.edits().commit(packageName=PKG, editId=eid).execute()
    print(f"OK: versionCode {vc} を '{track}' トラックに公開しました")


if __name__ == "__main__":
    try:
        main()
    except HttpError as e:
        status = getattr(e, "status_code", None) or getattr(getattr(e, "resp", None), "status", "")
        sys.exit(f"Play API error [{status}]: {str(e)[:400]}")
