import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, Category, Transaction, TransactionType, TransferDirection
from app.services.finance import FinanceService


class AnalyticsService:
    def __init__(self, session: AsyncSession, user_id: uuid.UUID): self.session, self.user_id = session, user_id

    async def cashflow(self, start: date, end: date, interval: str = "monthly") -> list[dict]:
        dialect = self.session.bind.dialect.name
        fmt = "%Y-%m" if interval == "monthly" else ("%Y" if interval == "yearly" else "%Y-%m-%d")
        period = func.strftime(fmt, Transaction.occurred_at) if dialect == "sqlite" else func.to_char(Transaction.occurred_at, "YYYY-MM" if interval == "monthly" else ("YYYY" if interval == "yearly" else "YYYY-MM-DD"))
        income = func.sum(case((Transaction.type == TransactionType.income, Transaction.amount), else_=0))
        expense = func.sum(case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0))
        rows = (await self.session.execute(select(period.label("period"), income.label("income"), expense.label("expense")).where(Transaction.user_id == self.user_id, Transaction.occurred_at >= datetime.combine(start, time.min, tzinfo=timezone.utc), Transaction.occurred_at <= datetime.combine(end, time.max, tzinfo=timezone.utc)).group_by(period).order_by(period))).all()
        return [{"period": r.period, "income": Decimal(r.income or 0), "expense": Decimal(r.expense or 0), "net": Decimal(r.income or 0) - Decimal(r.expense or 0)} for r in rows]

    async def category_spending(self, start: date, end: date) -> list[dict]:
        rows = (await self.session.execute(select(Category.id, Category.name, Category.color, func.sum(Transaction.amount).label("amount")).join(Transaction, Transaction.category_id == Category.id).where(Transaction.user_id == self.user_id, Transaction.type == TransactionType.expense, Transaction.occurred_at >= datetime.combine(start, time.min, tzinfo=timezone.utc), Transaction.occurred_at <= datetime.combine(end, time.max, tzinfo=timezone.utc)).group_by(Category.id, Category.name, Category.color).order_by(func.sum(Transaction.amount).desc()))).all()
        return [{"category_id": r.id, "category": r.name, "color": r.color, "amount": Decimal(r.amount)} for r in rows]

    async def asset_history(self, start: date, end: date, interval: str = "monthly") -> list[dict]:
        accounts = list(await self.session.scalars(select(Account).where(Account.user_id == self.user_id, Account.is_archived.is_(False))))
        points, cursor = [], date(start.year, start.month, 1)
        service = FinanceService(self.session, self.user_id)
        while cursor <= end:
            if interval == "yearly": next_point = date(cursor.year + 1, 1, 1)
            elif interval == "daily": next_point = date.fromordinal(cursor.toordinal() + 1)
            else: next_point = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)
            point_date = min(date.fromordinal(next_point.toordinal() - 1), end)
            at = datetime.combine(point_date, time.max, tzinfo=timezone.utc)
            total = Decimal("0")
            for account in accounts:
                total += await service.account_balance(account, at)
            points.append({"date": point_date, "assets": total}); cursor = next_point
        return points
