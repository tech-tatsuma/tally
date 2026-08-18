import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.entities import AccountType, CategoryType, Frequency, TransactionType


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    account_type: AccountType = AccountType.bank
    institution_name: str | None = None
    initial_balance: Decimal = Decimal("0")
    currency: str = Field(default="JPY", min_length=3, max_length=3)
    description: str | None = None
    credit_closing_day: int | None = Field(default=None, ge=1, le=31)
    credit_payment_day: int | None = Field(default=None, ge=1, le=31)
    credit_payment_month_offset: int | None = Field(default=None, ge=0, le=2)
    credit_payment_account_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_credit_fields(self):
        auto_pay = (self.credit_closing_day, self.credit_payment_day, self.credit_payment_account_id)
        has_auto_pay = any(value is not None for value in auto_pay)
        if self.account_type != AccountType.credit:
            if has_auto_pay or self.credit_payment_month_offset is not None:
                raise ValueError("credit closing/payment fields require account_type=credit")
            return self
        if has_auto_pay and any(value is None for value in auto_pay):
            raise ValueError("credit_closing_day, credit_payment_day and credit_payment_account_id must be set together")
        if self.credit_payment_month_offset is not None and not has_auto_pay:
            raise ValueError("credit_payment_month_offset requires credit auto-pay settings")
        return self


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    account_type: AccountType | None = None
    institution_name: str | None = None
    description: str | None = None
    credit_closing_day: int | None = Field(default=None, ge=1, le=31)
    credit_payment_day: int | None = Field(default=None, ge=1, le=31)
    credit_payment_month_offset: int | None = Field(default=None, ge=0, le=2)
    credit_payment_account_id: uuid.UUID | None = None


class AccountRead(ORMModel):
    id: uuid.UUID
    name: str
    account_type: AccountType
    institution_name: str | None
    initial_balance: Decimal
    current_balance: Decimal
    currency: str
    description: str | None
    is_archived: bool
    credit_closing_day: int | None
    credit_payment_day: int | None
    credit_payment_month_offset: int | None
    credit_payment_account_id: uuid.UUID | None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: CategoryType
    icon: str | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class CategoryRead(ORMModel):
    id: uuid.UUID
    name: str
    type: CategoryType
    icon: str | None
    color: str | None


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class TransactionCreate(BaseModel):
    account_id: uuid.UUID
    destination_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    occurred_at: datetime
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    journal: str | None = None

    @model_validator(mode="after")
    def validate_transfer(self):
        if self.type == TransactionType.transfer and not self.destination_account_id:
            raise ValueError("destination_account_id is required for transfers")
        if self.destination_account_id == self.account_id:
            raise ValueError("transfer accounts must be different")
        return self


class TransactionUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=2)
    occurred_at: datetime | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    journal: str | None = None


class TransactionRead(ORMModel):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID | None
    type: TransactionType
    amount: Decimal
    occurred_at: datetime
    title: str
    description: str | None
    journal: str | None
    transfer_group_id: uuid.UUID | None
    transfer_direction: str | None
    credit_settlement_id: uuid.UUID | None


class TransactionPage(BaseModel):
    items: list[TransactionRead]
    total: int
    page: int
    page_size: int


class RecurringCreate(BaseModel):
    account_id: uuid.UUID
    category_id: uuid.UUID | None = None
    type: TransactionType
    amount: Decimal = Field(gt=0)
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    journal_template: str | None = None
    frequency: Frequency
    start_date: date
    end_date: date | None = None
    execution_day: int = Field(ge=1, le=31)
    enabled: bool = True

    @model_validator(mode="after")
    def dates_are_valid(self):
        if self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date must be before end_date")
        if self.type == TransactionType.transfer:
            raise ValueError("recurring transfers are not supported in MVP")
        return self


class RecurringUpdate(BaseModel):
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    type: TransactionType | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    journal_template: str | None = None
    frequency: Frequency | None = None
    start_date: date | None = None
    end_date: date | None = None
    execution_day: int | None = Field(default=None, ge=1, le=31)
    enabled: bool | None = None


class RecurringRead(ORMModel):
    id: uuid.UUID
    account_id: uuid.UUID
    category_id: uuid.UUID | None
    type: TransactionType
    amount: Decimal
    title: str
    description: str | None
    journal_template: str | None
    frequency: Frequency
    start_date: date
    end_date: date | None
    execution_day: int
    next_execution_date: date
    enabled: bool


class CreditSettlementRead(ORMModel):
    id: uuid.UUID
    credit_account_id: uuid.UUID
    payment_account_id: uuid.UUID
    period_key: str
    amount: Decimal
    transfer_group_id: uuid.UUID | None
    settled_on: date


class AssetPoint(BaseModel):
    date: date
    assets: Decimal


class CashflowPoint(BaseModel):
    period: str
    income: Decimal
    expense: Decimal
    net: Decimal
