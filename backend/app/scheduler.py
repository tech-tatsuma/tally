import asyncio
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.db.session import SessionLocal
from app.models.entities import User
from app.services.finance import FinanceService


async def process_once() -> None:
    async with SessionLocal() as session:
        user_ids = list(await session.scalars(select(User.id).where(User.is_active.is_(True))))
        for user_id in user_ids:
            service = FinanceService(session, user_id)
            await service.process_due_recurring_transactions(date.today())
            await service.process_due_credit_settlements(date.today())


async def run_forever():
    while True:
        try:
            await process_once()
        except (ProgrammingError, OperationalError) as exc:
            # Migrations may still be applying when the scheduler first starts.
            print(f"scheduler waiting for database readiness: {exc}")
        await asyncio.sleep(3600)


if __name__ == "__main__":
    asyncio.run(run_forever())
