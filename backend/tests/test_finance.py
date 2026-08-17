from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.entities import Account, Category, CategoryType, CreditSettlement, Transaction
from app.schemas.common import AccountCreate, AccountUpdate, RecurringCreate, RecurringUpdate, TransactionCreate, TransactionUpdate
from app.services.analytics import AnalyticsService
from app.services.backup import BackupService
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


async def test_recurring_update_changes_schedule(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    recurring = await service.create_recurring(RecurringCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="1200", title="Service", frequency="monthly", start_date=date(2026, 8, 1), execution_day=10))
    updated = await service.update_recurring(recurring.id, RecurringUpdate(amount="1500", execution_day=20, title="Updated service"))
    assert updated.amount == Decimal("1500")
    assert updated.execution_day == 20
    assert updated.title == "Updated service"


async def test_cashflow_and_asset_history(session):
    accounts, expense, income = await fixtures(session); finance = FinanceService(session, USER_ID)
    await finance.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=income.id, type="income", amount="3000", occurred_at=datetime(2026, 8, 2, tzinfo=timezone.utc), title="Income"))
    await finance.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="1200", occurred_at=datetime(2026, 8, 3, tzinfo=timezone.utc), title="Expense"))
    analytics = AnalyticsService(session, USER_ID)
    rows = await analytics.cashflow(date(2026, 8, 1), date(2026, 8, 31))
    assert rows[0]["net"] == Decimal("1800")
    history = await analytics.asset_history(date(2026, 8, 1), date(2026, 8, 31))
    assert history[-1]["assets"] == Decimal("16800")


def test_account_create_credit_fields_must_be_paired():
    with pytest.raises(ValueError):
        AccountCreate(name="Card", account_type="credit", credit_payment_day=25)
    with pytest.raises(ValueError):
        AccountCreate(name="Card", account_type="bank", credit_payment_day=25, credit_payment_account_id=USER_ID)


async def test_update_account_validates_credit_fields(session):
    accounts, _, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    with pytest.raises(HTTPException):
        await service.update_account(bank.id, AccountUpdate(credit_payment_day=25, credit_payment_account_id=accounts[1].id))
    card = await service.create_account(AccountCreate(name="Card", account_type="bank"))
    updated = await service.update_account(card["id"], AccountUpdate(account_type="credit", credit_payment_day=25, credit_payment_account_id=bank.id))
    assert updated["account_type"] == "credit"
    assert updated["credit_payment_day"] == 25
    with pytest.raises(HTTPException):
        await service.update_account(card["id"], AccountUpdate(credit_payment_account_id=card["id"]))
    with pytest.raises(HTTPException):
        await service.update_account(bank.id, AccountUpdate(account_type="credit", credit_payment_day=1, credit_payment_account_id=card["id"]))


async def test_credit_settlement_pays_from_linked_account_and_is_idempotent(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(AccountCreate(name="Card", account_type="credit", credit_payment_day=25, credit_payment_account_id=bank.id))
    card_account = await session.get(Account, card["id"])
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="3000", occurred_at=datetime(2026, 8, 10, tzinfo=timezone.utc), title="Groceries"))
    assert await service.account_balance(card_account) == Decimal("-3000")

    assert await service.process_due_credit_settlements(date(2026, 8, 20)) == 0
    assert await service.account_balance(card_account) == Decimal("-3000")

    assert await service.process_due_credit_settlements(date(2026, 8, 25)) == 1
    assert await service.account_balance(card_account) == Decimal("0")
    assert await service.account_balance(bank) == Decimal("7000")

    assert await service.process_due_credit_settlements(date(2026, 8, 25)) == 0
    assert await service.account_balance(bank) == Decimal("7000")

    settlements = await service.list_credit_settlements(card_account.id)
    assert len(settlements) == 1 and settlements[0].amount == Decimal("3000") and settlements[0].period_key == "2026-08"


async def test_credit_settlement_sweeps_late_entered_transactions(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(AccountCreate(name="Card", account_type="credit", credit_payment_day=25, credit_payment_account_id=bank.id))
    card_account = await session.get(Account, card["id"])

    assert await service.process_due_credit_settlements(date(2026, 8, 25)) == 0
    assert len(list(await session.scalars(select(CreditSettlement)))) == 0

    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="1500", occurred_at=datetime(2026, 8, 12, tzinfo=timezone.utc), title="Forgotten entry, added late"))

    assert await service.process_due_credit_settlements(date(2026, 9, 25)) == 1
    settlements = await service.list_credit_settlements(card_account.id)
    assert len(settlements) == 1 and settlements[0].period_key == "2026-09" and settlements[0].amount == Decimal("1500")


async def test_backup_round_trip(session):
    accounts, expense, _ = await fixtures(session)
    finance = FinanceService(session, USER_ID)
    await finance.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=expense.id, type="expense", amount="850", occurred_at=datetime(2026, 8, 14, tzinfo=timezone.utc), title="Lunch", journal="A good day"))
    backup = BackupService(session, USER_ID)
    exported = await backup.export()
    result = await backup.restore(exported)
    restored = list(await session.scalars(select(Transaction)))
    assert result["restored"]["transactions"] == 1
    assert restored[0].amount == Decimal("850")
    assert restored[0].journal == "A good day"
