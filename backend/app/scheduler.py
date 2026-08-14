import asyncio
import uuid
from datetime import date

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.finance import FinanceService


async def run_forever():
    user_id = uuid.UUID(get_settings().default_user_id)
    while True:
        async with SessionLocal() as session: await FinanceService(session, user_id).process_due_recurring_transactions(date.today())
        await asyncio.sleep(3600)


if __name__ == "__main__": asyncio.run(run_forever())

