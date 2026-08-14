import asyncio
from datetime import date

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.entities import User
from app.services.finance import FinanceService


async def run_forever():
    while True:
        async with SessionLocal() as session:
            user_ids = list(await session.scalars(select(User.id).where(User.is_active.is_(True))))
            for user_id in user_ids:
                await FinanceService(session, user_id).process_due_recurring_transactions(date.today())
        await asyncio.sleep(3600)


if __name__ == "__main__": asyncio.run(run_forever())
