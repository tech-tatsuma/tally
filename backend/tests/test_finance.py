from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models.entities import Account, Category, CategoryType, Transaction
from app.schemas.common import RecurringCreate, TransactionCreate, TransactionUpdate
from app.services.analytics import AnalyticsService
from app.services.finance import FinanceService
from tests.conftest import USER_ID


async def fixtures(session):
    accounts = list(await session.scalars(select(Account).order_by(Account.name)))
    expense = await session.scalar(select(Category).where(Category.type == CategoryType.expense))
    income = await session.scalar(select(Category).where(Category.type == CategoryType.income))
    return accounts, expense, income


async def test_transaction_create_update_delete_and_balance(session):
    accounts, expense, income = await fixtures(session); service = FinanceService(session, USER_ID)
    tx = await service.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="850", occurred_at=datetime.now(timezone.utc), title="Lunch"))
    assert await service.account_balance(accounts[0]) == Decimal("9150")
    tx = await service.update_transaction(tx.id, TransactionUpdate(amount="980"))
    assert tx.amount == Decimal("980")
    await service.delete_transaction(tx.id)
    assert await service.account_balance(accounts[0]) == Decimal("10000")
    await service.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=income.id, type="income", amount="2000", occurred_at=datetime.now(timezone.utc), title="Work"))
    assert await service.account_balance(accounts[0]) == Decimal("12000")


async def test_transfer_preserves_total_assets(session):
    accounts, _, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    before = sum([await service.account_balance(a) for a in accounts])
    await service.create_transaction(TransactionCreate(account_id=accounts[0].id, destination_account_id=accounts[1].id, type="transfer", amount="3000", occurred_at=datetime.now(timezone.utc), title="Move"))
    after = sum([await service.account_balance(a) for a in accounts])
    assert before == after
    assert len(list(await session.scalars(select(Transaction)))) == 2


async def test_recurring_is_idempotent(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    await service.create_recurring(RecurringCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="80000", title="Rent", frequency="monthly", start_date=date(2026, 8, 1), execution_day=25))
    assert await service.process_due_recurring_transactions(date(2026, 8, 25)) == 1
    assert await service.process_due_recurring_transactions(date(2026, 8, 25)) == 0


async def test_cashflow_and_asset_history(session):
    accounts, expense, income = await fixtures(session); finance = FinanceService(session, USER_ID)
    await finance.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=income.id, type="income", amount="3000", occurred_at=datetime(2026, 8, 2, tzinfo=timezone.utc), title="Income"))
    await finance.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="1200", occurred_at=datetime(2026, 8, 3, tzinfo=timezone.utc), title="Expense"))
    analytics = AnalyticsService(session, USER_ID)
    rows = await analytics.cashflow(date(2026, 8, 1), date(2026, 8, 31))
    assert rows[0]["net"] == Decimal("1800")
    history = await analytics.asset_history(date(2026, 8, 1), date(2026, 8, 31))
    assert history[-1]["assets"] == Decimal("16800")

