"""Apple subscription を1 batch 再照会する手動／cron 用 CLI。

この script は FastAPI lifespan から呼ばれないため、配置しただけでは定期実行されない。
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.apple_reconciliation import reconcile_apple_subscriptions  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import OwnerSessionLocal  # noqa: E402


async def main() -> None:
    settings = get_settings()
    async with OwnerSessionLocal() as session:
        async with session.begin():
            stats = await reconcile_apple_subscriptions(
                session,
                product_id=settings.apple_pro_product_id,
            )
    print(
        f"Apple reconciliation: seen={stats['seen']} "
        f"updated={stats['updated']} failed={stats['failed']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
