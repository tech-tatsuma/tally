from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.entities import Account, Category, CategoryType, CreditSettlement, Transaction
from app.api.router import update_category
from app.schemas.common import AccountCreate, AccountUpdate, CategoryUpdate, RecurringCreate, RecurringUpdate, TransactionCreate, TransactionUpdate
from app.services.analytics import AnalyticsService
from app.services.backup import BackupService
from app.services.finance import FinanceService, calendar_date, closing_on_or_after, iter_due_closing_dates, payment_date_for_closing
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


def credit_card(bank_id, closing_day=31, payment_day=27, offset=1):
    return AccountCreate(
        name="Card", account_type="credit", credit_closing_day=closing_day,
        credit_payment_day=payment_day, credit_payment_month_offset=offset, credit_payment_account_id=bank_id,
    )


def test_account_create_credit_fields_must_be_paired():
    with pytest.raises(ValueError):
        AccountCreate(name="Card", account_type="credit", credit_payment_day=27)
    with pytest.raises(ValueError):
        AccountCreate(name="Card", account_type="credit", credit_closing_day=31, credit_payment_day=27)
    with pytest.raises(ValueError):
        AccountCreate(name="Card", account_type="bank", credit_closing_day=31, credit_payment_day=27, credit_payment_account_id=USER_ID)


def test_credit_cycle_dates():
    assert calendar_date(2026, 2, 31) == date(2026, 2, 28)
    assert closing_on_or_after(date(2026, 8, 10), 31) == date(2026, 8, 31)
    assert closing_on_or_after(date(2026, 9, 1), 31) == date(2026, 9, 30)
    assert closing_on_or_after(date(2026, 8, 11), 10) == date(2026, 9, 10)
    assert payment_date_for_closing(date(2026, 8, 31), 27, 1) == date(2026, 9, 27)
    assert payment_date_for_closing(date(2026, 8, 10), 27, 0) == date(2026, 8, 27)
    assert list(iter_due_closing_dates(date(2026, 9, 26), 31, 27, 1, date(2026, 8, 10))) == []
    assert list(iter_due_closing_dates(date(2026, 9, 27), 31, 27, 1, date(2026, 8, 10))) == [date(2026, 8, 31)]
    assert list(iter_due_closing_dates(date(2026, 8, 27), 31, 27, 1, date(2026, 8, 10))) == []


async def test_update_account_validates_credit_fields(session):
    accounts, _, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    with pytest.raises(HTTPException):
        await service.update_account(bank.id, AccountUpdate(credit_closing_day=31, credit_payment_day=27, credit_payment_account_id=accounts[1].id))
    card = await service.create_account(AccountCreate(name="Card", account_type="bank"))
    updated = await service.update_account(card["id"], AccountUpdate(account_type="credit", credit_closing_day=31, credit_payment_day=27, credit_payment_account_id=bank.id))
    assert updated["account_type"] == "credit"
    assert updated["credit_closing_day"] == 31
    assert updated["credit_payment_day"] == 27
    assert updated["credit_payment_month_offset"] == 1
    with pytest.raises(HTTPException):
        await service.update_account(card["id"], AccountUpdate(credit_payment_account_id=card["id"]))
    with pytest.raises(HTTPException):
        await service.update_account(bank.id, AccountUpdate(account_type="credit", credit_closing_day=31, credit_payment_day=1, credit_payment_account_id=card["id"]))


async def test_credit_settlement_pays_month_end_close_next_month_27(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(credit_card(bank.id))
    card_account = await session.get(Account, card["id"])
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="3000", occurred_at=datetime(2026, 8, 10, tzinfo=timezone.utc), title="Groceries"))
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="500", occurred_at=datetime(2026, 9, 1, tzinfo=timezone.utc), title="After closing"))
    assert await service.account_balance(card_account) == Decimal("-3500")

    assert await service.process_due_credit_settlements(date(2026, 8, 27)) == 0
    assert await service.process_due_credit_settlements(date(2026, 8, 31)) == 0
    assert await service.process_due_credit_settlements(date(2026, 9, 26)) == 0
    assert await service.account_balance(card_account) == Decimal("-3500")

    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 1
    assert await service.account_balance(card_account) == Decimal("-500")
    assert await service.account_balance(bank) == Decimal("7000")

    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 0
    assert await service.account_balance(bank) == Decimal("7000")

    settlements = await service.list_credit_settlements(card_account.id)
    assert len(settlements) == 1 and settlements[0].amount == Decimal("3000") and settlements[0].period_key == "2026-08"
    assert settlements[0].settled_on == date(2026, 9, 27)

    assert await service.process_due_credit_settlements(date(2026, 10, 27)) == 1
    assert await service.account_balance(card_account) == Decimal("0")
    september = (await service.list_credit_settlements(card_account.id))[0]
    assert september.period_key == "2026-09" and september.amount == Decimal("500")


async def test_credit_settlement_same_month_payment(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(credit_card(bank.id, closing_day=10, payment_day=27, offset=0))
    card_account = await session.get(Account, card["id"])
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="2000", occurred_at=datetime(2026, 8, 5, tzinfo=timezone.utc), title="Before close"))
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="800", occurred_at=datetime(2026, 8, 11, tzinfo=timezone.utc), title="After close"))

    assert await service.process_due_credit_settlements(date(2026, 8, 26)) == 0
    assert await service.process_due_credit_settlements(date(2026, 8, 27)) == 1
    assert await service.account_balance(card_account) == Decimal("-800")
    settlements = await service.list_credit_settlements(card_account.id)
    assert settlements[0].period_key == "2026-08" and settlements[0].amount == Decimal("2000")


async def test_credit_settlement_sweeps_late_entered_transactions(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(credit_card(bank.id))
    card_account = await session.get(Account, card["id"])

    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 0
    assert len(list(await session.scalars(select(CreditSettlement)))) == 0

    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="1500", occurred_at=datetime(2026, 8, 12, tzinfo=timezone.utc), title="Forgotten entry, added late"))

    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 1
    settlements = await service.list_credit_settlements(card_account.id)
    assert len(settlements) == 1 and settlements[0].period_key == "2026-08" and settlements[0].amount == Decimal("1500")


async def test_credit_settlement_late_entry_after_period_already_settled(session):
    accounts, expense, _ = await fixtures(session); service = FinanceService(session, USER_ID)
    bank = accounts[0]
    card = await service.create_account(credit_card(bank.id))
    card_account = await session.get(Account, card["id"])
    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="1000", occurred_at=datetime(2026, 8, 5, tzinfo=timezone.utc), title="On time"))
    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 1

    await service.create_transaction(TransactionCreate(account_id=card_account.id, category_id=expense.id, type="expense", amount="400", occurred_at=datetime(2026, 8, 20, tzinfo=timezone.utc), title="Forgotten after settlement"))
    assert await service.process_due_credit_settlements(date(2026, 9, 27)) == 0
    assert await service.process_due_credit_settlements(date(2026, 10, 27)) == 1
    settlements = await service.list_credit_settlements(card_account.id)
    assert [s.period_key for s in settlements] == ["2026-09", "2026-08"]
    assert settlements[0].amount == Decimal("400")


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


async def test_update_category_name_color_and_unused_type(session):
    accounts, expense, income = await fixtures(session)
    updated = await update_category(expense.id, CategoryUpdate(name="食料品", color="#ff9100"), session, USER_ID)
    assert updated.name == "食料品"
    assert updated.color == "#ff9100"
    switched = await update_category(expense.id, CategoryUpdate(type="income"), session, USER_ID)
    assert switched.type.value == "income"
    service = FinanceService(session, USER_ID)
    await service.create_transaction(TransactionCreate(account_id=accounts[0].id, category_id=income.id, type="income", amount="2000", occurred_at=datetime.now(timezone.utc), title="Work"))
    with pytest.raises(HTTPException) as error:
        await update_category(income.id, CategoryUpdate(type="expense"), session, USER_ID)
    assert error.value.status_code == 409
