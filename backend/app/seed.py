import asyncio
import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.entities import Account, AccountType, Category, CategoryType, Frequency, RecurringTransaction, Transaction, TransactionType, User
from app.core.security import hash_password
from app.models.entities import UserRole


async def seed():
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    user_id = uuid.UUID(get_settings().default_user_id)
    async with SessionLocal() as s:
        if await s.scalar(select(User.id).where(User.id == user_id)): return
        user = User(id=user_id, name="たつま", email="tatsuma@example.com", password_hash=hash_password(get_settings().seed_admin_password), role=UserRole.admin)
        accounts = [Account(user_id=user_id, name="メイン銀行", institution_name="みらい銀行", account_type=AccountType.bank, initial_balance=Decimal("1080000")), Account(user_id=user_id, name="貯蓄口座", institution_name="つばさ銀行", account_type=AccountType.bank, initial_balance=Decimal("720000")), Account(user_id=user_id, name="現金", account_type=AccountType.cash, initial_balance=Decimal("80000")), Account(user_id=user_id, name="投資", account_type=AccountType.investment, initial_balance=Decimal("350000"))]
        categories = [Category(user_id=user_id, name=n, type=t, color=c) for n, t, c in [
            ("食費", CategoryType.expense, "#00c4cc"),
            ("カフェ", CategoryType.expense, "#ffcd00"),
            ("住居費", CategoryType.expense, "#2d4b9b"),
            ("交通費", CategoryType.expense, "#69d7ff"),
            ("娯楽", CategoryType.expense, "#e65537"),
            ("給与", CategoryType.income, "#4bb47d"),
        ]]
        s.add(user); s.add_all(accounts + categories); await s.flush()
        credit_card = Account(user_id=user_id, name="メインカード", institution_name="みらいカード", account_type=AccountType.credit, initial_balance=Decimal("0"), credit_closing_day=31, credit_payment_day=27, credit_payment_month_offset=1, credit_payment_account_id=accounts[0].id)
        s.add(credit_card); await s.flush()
        s.add_all([
            Transaction(user_id=user_id, account_id=credit_card.id, category_id=categories[0].id, type=TransactionType.expense, amount=Decimal("4200"), occurred_at=datetime.now(timezone.utc) - timedelta(days=3), title="スーパーで買い物"),
            Transaction(user_id=user_id, account_id=credit_card.id, category_id=categories[4].id, type=TransactionType.expense, amount=Decimal("2600"), occurred_at=datetime.now(timezone.utc) - timedelta(days=1), title="動画配信サブスク"),
        ])
        today = datetime.now(timezone.utc)
        for month_back in range(6):
            when = today - timedelta(days=30 * month_back)
            s.add(Transaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[5].id, type=TransactionType.income, amount=Decimal("350000"), occurred_at=when.replace(day=25), title="給与"))
            s.add(Transaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[2].id, type=TransactionType.expense, amount=Decimal("80000"), occurred_at=when.replace(day=1), title="家賃"))
            for offset, (title, amount, category) in enumerate([("友人と夕食", "6800", 0), ("朝のコーヒー", "520", 1), ("電車の定期", "12840", 3), ("映画", "1900", 4)]):
                s.add(Transaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[category].id, type=TransactionType.expense, amount=Decimal(amount), occurred_at=when - timedelta(days=offset * 3 + 2), title=title, journal="今日の出来事を、お金の記録と一緒に残しました。" if offset == 0 else None))
        today = date.today()
        def next_run(day: int) -> date:
            candidate = date(today.year, today.month, min(day, calendar.monthrange(today.year, today.month)[1]))
            if candidate >= today: return candidate
            month = 1 if today.month == 12 else today.month + 1; year = today.year + (today.month == 12)
            return date(year, month, min(day, calendar.monthrange(year, month)[1]))
        s.add_all([
            RecurringTransaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[2].id, type=TransactionType.expense, amount=Decimal("80000"), title="家賃", frequency=Frequency.monthly, start_date=date(today.year, 1, 1), execution_day=25, next_execution_date=next_run(25), enabled=True),
            RecurringTransaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[4].id, type=TransactionType.expense, amount=Decimal("1490"), title="Netflix", frequency=Frequency.monthly, start_date=date(today.year, 1, 1), execution_day=15, next_execution_date=next_run(15), enabled=True),
            RecurringTransaction(user_id=user_id, account_id=accounts[0].id, category_id=categories[5].id, type=TransactionType.income, amount=Decimal("350000"), title="給与", frequency=Frequency.monthly, start_date=date(today.year, 1, 1), execution_day=25, next_execution_date=next_run(25), enabled=True),
        ])
        await s.commit()


if __name__ == "__main__": asyncio.run(seed())
