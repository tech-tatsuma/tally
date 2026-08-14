import uuid
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, Category, Transaction, TransactionType


class FinanceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def account(self, user_id: uuid.UUID, account_id: uuid.UUID) -> Account | None:
        return await self.session.scalar(select(Account).where(Account.id == account_id, Account.user_id == user_id))

    async def category(self, user_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
        return await self.session.scalar(select(Category).where(Category.id == category_id, Category.user_id == user_id))

    async def transaction(self, user_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction | None:
        return await self.session.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user_id))

    async def list_transactions(
        self, user_id: uuid.UUID, *, start: datetime | None = None, end: datetime | None = None,
        account_id: uuid.UUID | None = None, category_id: uuid.UUID | None = None,
        type_: TransactionType | None = None, keyword: str | None = None, page: int = 1, page_size: int = 50,
    ) -> tuple[list[Transaction], int]:
        filters = [Transaction.user_id == user_id]
        if start: filters.append(Transaction.occurred_at >= start)
        if end: filters.append(Transaction.occurred_at <= end)
        if account_id: filters.append(Transaction.account_id == account_id)
        if category_id: filters.append(Transaction.category_id == category_id)
        if type_: filters.append(Transaction.type == type_)
        if keyword:
            term = f"%{keyword}%"
            filters.append(or_(Transaction.title.ilike(term), Transaction.description.ilike(term), Transaction.journal.ilike(term)))
        total = await self.session.scalar(select(func.count(Transaction.id)).where(*filters)) or 0
        rows = await self.session.scalars(select(Transaction).where(*filters).order_by(Transaction.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size))
        return list(rows), total

