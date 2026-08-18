import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AccountType(str, enum.Enum):
    bank = "bank"
    cash = "cash"
    wallet = "wallet"
    investment = "investment"
    credit = "credit"
    other = "other"


class TransactionType(str, enum.Enum):
    income = "income"
    expense = "expense"
    transfer = "transfer"


class CategoryType(str, enum.Enum):
    income = "income"
    expense = "expense"


class TransferDirection(str, enum.Enum):
    debit = "debit"
    credit = "credit"


class Frequency(str, enum.Enum):
    monthly = "monthly"
    yearly = "yearly"


class UserRole(str, enum.Enum):
    admin = "admin"
    user = "user"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.user, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tokyo")
    currency: Mapped[str] = mapped_column(String(3), default="JPY")


class UserSession(TimestampMixin, Base):
    __tablename__ = "user_sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordResetToken(TimestampMixin, Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiToken(TimestampMixin, Base):
    __tablename__ = "api_tokens"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(16), index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class McpConnection(TimestampMixin, Base):
    """A revocable, user-scoped capability URL for Streamable HTTP MCP."""

    __tablename__ = "mcp_connections"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    secret_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    secret_prefix: Mapped[str] = mapped_column(String(18), index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class Account(TimestampMixin, Base):
    __tablename__ = "accounts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    institution_name: Mapped[str | None] = mapped_column(String(120))
    initial_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), default="JPY")
    description: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Credit-card cycle: closing day (31 = month-end), payment day, and which month pays (0/1/2).
    credit_closing_day: Mapped[int | None] = mapped_column(Integer)
    credit_payment_day: Mapped[int | None] = mapped_column(Integer)
    credit_payment_month_offset: Mapped[int | None] = mapped_column(Integer)
    credit_payment_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", use_alter=True, name="fk_accounts_credit_payment_account_id_accounts", deferrable=True, initially="DEFERRED")
    )


class Category(TimestampMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "name", "type"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType))
    icon: Mapped[str | None] = mapped_column(String(30))
    color: Mapped[str | None] = mapped_column(String(7))


class CreditSettlement(TimestampMixin, Base):
    """Records one automatic credit-card payoff for a closing-month cycle.

    period_key is the closing year-month (e.g. 2026-08 for 月末締め → 翌月27日払い).
    Once a period is settled it is not settled again. Unsettled expense/income on the card
    with occurred_at on or before that closing date — including late or backdated entries
    from earlier cycles — is swept into whichever due settlement runs next.
    """

    __tablename__ = "credit_settlements"
    __table_args__ = (UniqueConstraint("credit_account_id", "period_key"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    credit_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    payment_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    period_key: Mapped[str] = mapped_column(String(10))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    transfer_group_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    settled_on: Mapped[date] = mapped_column(Date)


class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("recurring_transaction_id", "recurring_period_key"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"), index=True)
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    journal: Mapped[str | None] = mapped_column(Text)
    transfer_group_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    transfer_direction: Mapped[TransferDirection | None] = mapped_column(Enum(TransferDirection))
    recurring_transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("recurring_transactions.id"))
    recurring_period_key: Mapped[str | None] = mapped_column(String(10))
    credit_settlement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credit_settlements.id"), index=True)


class RecurringTransaction(TimestampMixin, Base):
    __tablename__ = "recurring_transactions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    journal_template: Mapped[str | None] = mapped_column(Text)
    frequency: Mapped[Frequency] = mapped_column(Enum(Frequency))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    execution_day: Mapped[int] = mapped_column(Integer)
    next_execution_date: Mapped[date] = mapped_column(Date, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
