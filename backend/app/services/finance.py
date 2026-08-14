import calendar
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, Category, CategoryType, RecurringTransaction, Transaction, TransactionType, TransferDirection
from app.repositories.finance import FinanceRepository
from app.schemas.common import AccountCreate, AccountUpdate, RecurringCreate, RecurringUpdate, TransactionCreate, TransactionUpdate


class FinanceService:
    def __init__(self, session: AsyncSession, user_id: uuid.UUID):
        self.session, self.user_id = session, user_id
        self.repo = FinanceRepository(session)

    async def account_balance(self, account: Account, at: datetime | None = None) -> Decimal:
        impact = case(
            (Transaction.type == TransactionType.income, Transaction.amount),
            (Transaction.type == TransactionType.expense, -Transaction.amount),
            (Transaction.transfer_direction == TransferDirection.credit, Transaction.amount),
            (Transaction.transfer_direction == TransferDirection.debit, -Transaction.amount),
            else_=0,
        )
        filters = [Transaction.user_id == self.user_id, Transaction.account_id == account.id]
        if at: filters.append(Transaction.occurred_at <= at)
        movement = await self.session.scalar(select(func.coalesce(func.sum(impact), 0)).where(*filters))
        return Decimal(account.initial_balance) + Decimal(movement or 0)

    async def list_accounts(self, include_archived: bool = False) -> list[dict]:
        filters = [Account.user_id == self.user_id]
        if not include_archived: filters.append(Account.is_archived.is_(False))
        accounts = list(await self.session.scalars(select(Account).where(*filters).order_by(Account.created_at)))
        return [{**a.__dict__, "current_balance": await self.account_balance(a)} for a in accounts]

    async def get_account(self, account_id: uuid.UUID) -> dict:
        account = await self.repo.account(self.user_id, account_id)
        if not account: raise HTTPException(404, "Account not found")
        return {**account.__dict__, "current_balance": await self.account_balance(account)}

    async def create_account(self, data: AccountCreate) -> dict:
        account = Account(user_id=self.user_id, **data.model_dump())
        self.session.add(account); await self.session.flush(); await self.session.commit()
        return await self.get_account(account.id)

    async def update_account(self, account_id: uuid.UUID, data: AccountUpdate) -> dict:
        account = await self.repo.account(self.user_id, account_id)
        if not account: raise HTTPException(404, "Account not found")
        for key, value in data.model_dump(exclude_unset=True).items(): setattr(account, key, value)
        await self.session.commit(); return await self.get_account(account.id)

    async def archive_account(self, account_id: uuid.UUID) -> None:
        account = await self.repo.account(self.user_id, account_id)
        if not account: raise HTTPException(404, "Account not found")
        account.is_archived = True; await self.session.commit()

    async def validate_category(self, category_id: uuid.UUID | None, type_: TransactionType) -> None:
        if not category_id: return
        category = await self.repo.category(self.user_id, category_id)
        expected = CategoryType.income if type_ == TransactionType.income else CategoryType.expense
        if not category or category.type != expected: raise HTTPException(422, "Category does not match transaction type")

    async def create_transaction(self, data: TransactionCreate) -> Transaction:
        source = await self.repo.account(self.user_id, data.account_id)
        if not source or source.is_archived: raise HTTPException(422, "Account not found or archived")
        await self.validate_category(data.category_id, data.type)
        values = data.model_dump(exclude={"destination_account_id"})
        if data.type != TransactionType.transfer:
            tx = Transaction(user_id=self.user_id, **values)
            self.session.add(tx); await self.session.flush(); await self.session.commit(); return tx
        destination = await self.repo.account(self.user_id, data.destination_account_id)
        if not destination or destination.is_archived: raise HTTPException(422, "Destination account not found or archived")
        group = uuid.uuid4()
        transfer_values = {**values, "category_id": None}
        debit = Transaction(user_id=self.user_id, **transfer_values, transfer_group_id=group, transfer_direction=TransferDirection.debit)
        credit = Transaction(user_id=self.user_id, **{**transfer_values, "account_id": destination.id}, transfer_group_id=group, transfer_direction=TransferDirection.credit)
        self.session.add_all([debit, credit]); await self.session.flush(); await self.session.commit(); return debit

    async def update_transaction(self, transaction_id: uuid.UUID, data: TransactionUpdate) -> Transaction:
        tx = await self.repo.transaction(self.user_id, transaction_id)
        if not tx: raise HTTPException(404, "Transaction not found")
        if tx.type == TransactionType.transfer: raise HTTPException(409, "Edit transfers by replacing the transfer")
        await self.validate_category(data.category_id if "category_id" in data.model_fields_set else tx.category_id, tx.type)
        for key, value in data.model_dump(exclude_unset=True).items(): setattr(tx, key, value)
        await self.session.commit(); await self.session.refresh(tx); return tx

    async def delete_transaction(self, transaction_id: uuid.UUID) -> None:
        tx = await self.repo.transaction(self.user_id, transaction_id)
        if not tx: raise HTTPException(404, "Transaction not found")
        if tx.transfer_group_id:
            await self.session.execute(delete(Transaction).where(Transaction.user_id == self.user_id, Transaction.transfer_group_id == tx.transfer_group_id))
        else: await self.session.delete(tx)
        await self.session.commit()

    async def create_recurring(self, data: RecurringCreate) -> RecurringTransaction:
        if not await self.repo.account(self.user_id, data.account_id): raise HTTPException(422, "Account not found")
        await self.validate_category(data.category_id, data.type)
        next_date = self._next_occurrence(data.start_date, data.execution_day, data.frequency.value)
        recurring = RecurringTransaction(user_id=self.user_id, next_execution_date=next_date, **data.model_dump())
        self.session.add(recurring); await self.session.commit(); await self.session.refresh(recurring); return recurring

    async def update_recurring(self, recurring_id: uuid.UUID, data: RecurringUpdate) -> RecurringTransaction:
        recurring = await self.session.scalar(select(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.user_id == self.user_id))
        if not recurring: raise HTTPException(404, "Recurring transaction not found")
        for key, value in data.model_dump(exclude_unset=True).items(): setattr(recurring, key, value)
        await self.session.commit(); await self.session.refresh(recurring); return recurring

    @staticmethod
    def _next_occurrence(base: date, day: int, frequency: str) -> date:
        safe_day = min(day, calendar.monthrange(base.year, base.month)[1])
        candidate = date(base.year, base.month, safe_day)
        if candidate >= base: return candidate
        if frequency == "yearly": return date(base.year + 1, base.month, min(day, calendar.monthrange(base.year + 1, base.month)[1]))
        month = 1 if base.month == 12 else base.month + 1; year = base.year + (base.month == 12)
        return date(year, month, min(day, calendar.monthrange(year, month)[1]))

    async def process_due_recurring_transactions(self, today: date) -> int:
        due = list(await self.session.scalars(select(RecurringTransaction).where(RecurringTransaction.user_id == self.user_id, RecurringTransaction.enabled.is_(True), RecurringTransaction.next_execution_date <= today).with_for_update()))
        created = 0
        for recurring in due:
            while recurring.next_execution_date <= today and (not recurring.end_date or recurring.next_execution_date <= recurring.end_date):
                run_date = recurring.next_execution_date
                key = run_date.strftime("%Y-%m") if recurring.frequency.value == "monthly" else str(run_date.year)
                exists = await self.session.scalar(select(Transaction.id).where(Transaction.recurring_transaction_id == recurring.id, Transaction.recurring_period_key == key))
                if not exists:
                    self.session.add(Transaction(user_id=self.user_id, account_id=recurring.account_id, category_id=recurring.category_id, type=recurring.type, amount=recurring.amount, occurred_at=datetime.combine(run_date, time(0), tzinfo=timezone.utc), title=recurring.title, description=recurring.description, journal=recurring.journal_template, recurring_transaction_id=recurring.id, recurring_period_key=key)); created += 1
                step = date(run_date.year + 1, run_date.month, 1) if recurring.frequency.value == "yearly" else date(run_date.year + (run_date.month == 12), 1 if run_date.month == 12 else run_date.month + 1, 1)
                recurring.next_execution_date = self._next_occurrence(step, recurring.execution_day, recurring.frequency.value)
        await self.session.commit(); return created

    async def dashboard(self) -> dict:
        accounts = await self.list_accounts(); total = sum((a["current_balance"] for a in accounts), Decimal("0"))
        now = datetime.now(timezone.utc); start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        txs, _ = await self.repo.list_transactions(self.user_id, start=start, page_size=8)
        income = sum((Decimal(t.amount) for t in txs if t.type == TransactionType.income), Decimal("0"))
        expense = sum((Decimal(t.amount) for t in txs if t.type == TransactionType.expense), Decimal("0"))
        return {"total_assets": total, "accounts": accounts, "month": {"income": income, "expense": expense, "balance": income - expense}, "recent_transactions": txs[:6]}
