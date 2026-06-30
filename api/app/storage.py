"""Object storage (S3 / MinIO) for receipt images, audio, and PDFs.

boto3 is synchronous; callers wrap these in run_in_threadpool to avoid blocking
the event loop.
"""

import boto3
from botocore.exceptions import ClientError

from .config import get_settings

settings = get_settings()

_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    region_name=settings.s3_region,
)


def ensure_bucket() -> None:
    try:
        _s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        _s3.create_bucket(Bucket=settings.s3_bucket)


def put(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)


def get(key: str) -> bytes:
    return _s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def delete(key: str) -> None:
    _s3.delete_object(Bucket=settings.s3_bucket, Key=key)
