import calendar
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, AccountType, Category, CategoryType, CreditSettlement, RecurringTransaction, Transaction, TransactionType, TransferDirection
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

    async def _validate_credit_fields(self, account_type: AccountType, payment_day: int | None, payment_account_id: uuid.UUID | None, self_id: uuid.UUID | None = None) -> None:
        if account_type != AccountType.credit:
            if payment_day is not None or payment_account_id is not None:
                raise HTTPException(422, "credit_payment_day and credit_payment_account_id require account_type=credit")
            return
        if (payment_day is None) != (payment_account_id is None):
            raise HTTPException(422, "credit_payment_day and credit_payment_account_id must be set together")
        if payment_account_id is None: return
        if self_id is not None and payment_account_id == self_id:
            raise HTTPException(422, "credit_payment_account_id must be a different account")
        payment_account = await self.repo.account(self.user_id, payment_account_id)
        if not payment_account or payment_account.is_archived: raise HTTPException(422, "Payment account not found or archived")
        if payment_account.account_type == AccountType.credit: raise HTTPException(422, "Payment account cannot itself be a credit account")

    async def create_account(self, data: AccountCreate) -> dict:
        await self._validate_credit_fields(data.account_type, data.credit_payment_day, data.credit_payment_account_id)
        account = Account(user_id=self.user_id, **data.model_dump())
        self.session.add(account); await self.session.flush(); await self.session.commit()
        return await self.get_account(account.id)

    async def update_account(self, account_id: uuid.UUID, data: AccountUpdate) -> dict:
        account = await self.repo.account(self.user_id, account_id)
        if not account: raise HTTPException(404, "Account not found")
        values = data.model_dump(exclude_unset=True)
        account_type = values.get("account_type", account.account_type)
        payment_day = values.get("credit_payment_day", account.credit_payment_day)
        payment_account_id = values.get("credit_payment_account_id", account.credit_payment_account_id)
        await self._validate_credit_fields(account_type, payment_day, payment_account_id, self_id=account.id)
        for key, value in values.items(): setattr(account, key, value)
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
        account_id = data.account_id or recurring.account_id
        type_ = data.type or recurring.type
        category_id = data.category_id if "category_id" in data.model_fields_set else recurring.category_id
        if not await self.repo.account(self.user_id, account_id): raise HTTPException(422, "Account not found")
        await self.validate_category(category_id, type_)
        for key, value in data.model_dump(exclude_unset=True).items(): setattr(recurring, key, value)
        if recurring.end_date and recurring.start_date > recurring.end_date:
            raise HTTPException(422, "start_date must be before end_date")
        if {"start_date", "execution_day", "frequency"} & data.model_fields_set:
            base = max(recurring.start_date, date.today())
            recurring.next_execution_date = self._next_occurrence(base, recurring.execution_day, recurring.frequency.value)
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

    async def process_due_credit_settlements(self, today: date) -> int:
        """Auto-pay each credit account's outstanding balance from its linked payment account.

        Runs once per (credit account, calendar month), on or after credit_payment_day. Every
        run sweeps *all* not-yet-settled expense/income transactions on the credit account, no
        matter how old - so a transaction entered late (or backdated) is simply picked up by
        whichever settlement runs next, instead of being silently missed.
        """
        credit_accounts = list(await self.session.scalars(select(Account).where(
            Account.user_id == self.user_id, Account.account_type == AccountType.credit, Account.is_archived.is_(False),
            Account.credit_payment_day.isnot(None), Account.credit_payment_account_id.isnot(None),
        ).with_for_update()))
        settled = 0
        for credit in credit_accounts:
            effective_day = min(credit.credit_payment_day, calendar.monthrange(today.year, today.month)[1])
            if today.day < effective_day: continue
            period_key = today.strftime("%Y-%m")
            already = await self.session.scalar(select(CreditSettlement.id).where(CreditSettlement.credit_account_id == credit.id, CreditSettlement.period_key == period_key))
            if already: continue
            payment_account = await self.repo.account(self.user_id, credit.credit_payment_account_id)
            if not payment_account or payment_account.is_archived: continue
            cutoff = datetime.combine(today + timedelta(days=1), time(0), tzinfo=timezone.utc)
            unsettled = list(await self.session.scalars(select(Transaction).where(
                Transaction.user_id == self.user_id, Transaction.account_id == credit.id, Transaction.credit_settlement_id.is_(None),
                Transaction.type.in_([TransactionType.expense, TransactionType.income]), Transaction.occurred_at < cutoff,
            )))
            if not unsettled: continue
            amount = sum((tx.amount if tx.type == TransactionType.expense else -tx.amount for tx in unsettled), Decimal("0"))
            if amount <= 0: continue
            group = uuid.uuid4()
            occurred_at = datetime.combine(today, time(0), tzinfo=timezone.utc)
            title = f"{credit.name} 自動引き落とし"
            debit = Transaction(user_id=self.user_id, account_id=payment_account.id, type=TransactionType.transfer, amount=amount, occurred_at=occurred_at, title=title, transfer_group_id=group, transfer_direction=TransferDirection.debit)
            credit_leg = Transaction(user_id=self.user_id, account_id=credit.id, type=TransactionType.transfer, amount=amount, occurred_at=occurred_at, title=title, transfer_group_id=group, transfer_direction=TransferDirection.credit)
            settlement = CreditSettlement(user_id=self.user_id, credit_account_id=credit.id, payment_account_id=payment_account.id, period_key=period_key, amount=amount, transfer_group_id=group, settled_on=today)
            self.session.add_all([debit, credit_leg, settlement]); await self.session.flush()
            for tx in unsettled: tx.credit_settlement_id = settlement.id
            settled += 1
        await self.session.commit(); return settled

    async def list_credit_settlements(self, account_id: uuid.UUID) -> list[CreditSettlement]:
        if not await self.repo.account(self.user_id, account_id): raise HTTPException(404, "Account not found")
        return list(await self.session.scalars(select(CreditSettlement).where(CreditSettlement.user_id == self.user_id, CreditSettlement.credit_account_id == account_id).order_by(CreditSettlement.settled_on.desc())))

    async def dashboard(self) -> dict:
        accounts = await self.list_accounts(); total = sum((a["current_balance"] for a in accounts), Decimal("0"))
        now = datetime.now(timezone.utc); start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        txs, _ = await self.repo.list_transactions(self.user_id, start=start, page_size=8)
        income = sum((Decimal(t.amount) for t in txs if t.type == TransactionType.income), Decimal("0"))
        expense = sum((Decimal(t.amount) for t in txs if t.type == TransactionType.expense), Decimal("0"))
        return {"total_assets": total, "accounts": accounts, "month": {"income": income, "expense": expense, "balance": income - expense}, "recent_transactions": txs[:6]}
