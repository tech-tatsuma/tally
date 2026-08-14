import uuid
from decimal import Decimal

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Account, AccountType, Category, CategoryType, User


USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection: await connection.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        s.add(User(id=USER_ID, name="Test", email="test@example.com")); await s.flush()
        account = Account(user_id=USER_ID, name="Main", account_type=AccountType.bank, initial_balance=Decimal("10000"))
        destination = Account(user_id=USER_ID, name="Savings", account_type=AccountType.bank, initial_balance=Decimal("5000"))
        expense = Category(user_id=USER_ID, name="Food", type=CategoryType.expense)
        income = Category(user_id=USER_ID, name="Salary", type=CategoryType.income)
        s.add_all([account, destination, expense, income]); await s.commit()
        yield s
    await engine.dispose()

