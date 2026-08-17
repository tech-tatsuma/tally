import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_request
from sqlalchemy import select

from app.core.security import token_hash
from app.db.session import SessionLocal
from app.models.entities import McpConnection, TransactionType, User
from app.repositories.finance import FinanceRepository
from app.schemas.common import AccountCreate, AccountUpdate, RecurringCreate, RecurringUpdate, TransactionCreate, TransactionUpdate
from app.services.analytics import AnalyticsService
from app.services.finance import FinanceService

mcp = FastMCP("Tally — personal finance and journal")


@asynccontextmanager
async def user_session():
    """Resolve the Streamable HTTP capability URL to exactly one active user."""
    try:
        raw = get_http_request().path_params["connection_key"]
    except (KeyError, RuntimeError) as error:
        raise PermissionError("A user-specific Tally MCP URL is required") from error
    if not raw.startswith("tlly_mcpurl_"):
        raise PermissionError("MCP URL is invalid or has been revoked")
    async with SessionLocal() as session:
        item = await session.scalar(select(McpConnection).where(McpConnection.secret_hash == token_hash(raw), McpConnection.revoked_at.is_(None)))
        now = datetime.now().astimezone()
        user = await session.get(User, item.user_id) if item else None
        if not user or not user.is_active:
            raise PermissionError("MCP URL is invalid, revoked, or its user is disabled")
        item.last_used_at = now
        await session.commit()
        yield session, user.id


def clean(value):
    if isinstance(value, (Decimal, uuid.UUID, date, datetime)): return str(value)
    if hasattr(value, "value"): return value.value
    if isinstance(value, list): return [clean(v) for v in value]
    if isinstance(value, dict): return {k: clean(v) for k, v in value.items() if not k.startswith("_")}
    return value


@mcp.tool(description="List the user's active accounts with balances calculated from transactions.")
async def list_accounts():
    async with user_session() as (s, user_id): return clean(await FinanceService(s, user_id).list_accounts())


@mcp.tool(description="Get one account and its current calculated balance by exact account ID.")
async def get_account(account_id: str):
    async with user_session() as (s, user_id): return clean(await FinanceService(s, user_id).get_account(uuid.UUID(account_id)))


@mcp.tool(description="Create a bank, cash, wallet, investment, or other account.")
async def create_account(name: str, account_type: str = "bank", initial_balance: str = "0", institution_name: str | None = None):
    async with user_session() as (s, user_id): return clean(await FinanceService(s, user_id).create_account(AccountCreate(name=name, account_type=account_type, initial_balance=Decimal(initial_balance), institution_name=institution_name)))


@mcp.tool(description="Update an account by exact ID. Only supplied fields are changed.")
async def update_account(account_id: str, name: str | None = None, description: str | None = None):
    async with user_session() as (s, user_id): return clean(await FinanceService(s, user_id).update_account(uuid.UUID(account_id), AccountUpdate(name=name, description=description)))


@mcp.tool(description="Archive an account by exact ID. Its history remains intact.")
async def delete_account(account_id: str):
    async with user_session() as (s, user_id): await FinanceService(s, user_id).archive_account(uuid.UUID(account_id)); return {"archived": account_id}


@mcp.tool(description="Get the calculated balance for one account by exact ID.")
async def get_account_balance(account_id: str): return await get_account(account_id)


@mcp.tool(description="Search transactions before choosing an exact ID to update or delete. Supports date range, account, category, type, and keyword.")
async def list_transactions(start: str | None = None, end: str | None = None, account_id: str | None = None, category_id: str | None = None, transaction_type: str | None = None, keyword: str | None = None, page: int = 1, page_size: int = 50):
    async with user_session() as (s, user_id):
        items, total = await FinanceRepository(s).list_transactions(user_id, start=datetime.fromisoformat(start) if start else None, end=datetime.fromisoformat(end) if end else None, account_id=uuid.UUID(account_id) if account_id else None, category_id=uuid.UUID(category_id) if category_id else None, type_=TransactionType(transaction_type) if transaction_type else None, keyword=keyword, page=page, page_size=page_size)
        return clean({"items": [i.__dict__ for i in items], "total": total, "next_step": "Use the exact transaction id for updates or deletion."})


@mcp.tool(description="Get one transaction by exact ID, including description and journal.")
async def get_transaction(transaction_id: str):
    async with user_session() as (s, user_id):
        tx = await FinanceRepository(s).transaction(user_id, uuid.UUID(transaction_id)); return clean(tx.__dict__) if tx else {"error": "not_found"}


@mcp.tool(description="Create an income, expense, or transfer. Amount is a positive decimal string; occurred_at must include an ISO date/time offset.")
async def create_transaction(account_id: str, transaction_type: str, amount: str, occurred_at: str, title: str, category_id: str | None = None, destination_account_id: str | None = None, description: str | None = None, journal: str | None = None):
    data = TransactionCreate(account_id=account_id, destination_account_id=destination_account_id, type=transaction_type, amount=Decimal(amount), occurred_at=datetime.fromisoformat(occurred_at), title=title, category_id=category_id, description=description, journal=journal)
    async with user_session() as (s, user_id): return clean((await FinanceService(s, user_id).create_transaction(data)).__dict__)


@mcp.tool(description="Update one transaction by exact ID. Search first if the user's description is ambiguous.")
async def update_transaction(transaction_id: str, amount: str | None = None, title: str | None = None, description: str | None = None, journal: str | None = None):
    async with user_session() as (s, user_id): return clean((await FinanceService(s, user_id).update_transaction(uuid.UUID(transaction_id), TransactionUpdate(amount=Decimal(amount) if amount else None, title=title, description=description, journal=journal))).__dict__)


@mcp.tool(description="Delete one transaction by exact ID. Search and confirm candidates before calling this tool.")
async def delete_transaction(transaction_id: str):
    async with user_session() as (s, user_id): await FinanceService(s, user_id).delete_transaction(uuid.UUID(transaction_id)); return {"deleted": transaction_id}


@mcp.tool(description="List fixed expenses and recurring income with enabled state and next run date.")
async def list_recurring_transactions():
    from app.models.entities import RecurringTransaction
    async with user_session() as (s, user_id): return clean([r.__dict__ for r in await s.scalars(select(RecurringTransaction).where(RecurringTransaction.user_id == user_id))])


@mcp.tool(description="Create a monthly or yearly recurring income/expense.")
async def create_recurring_transaction(account_id: str, transaction_type: str, amount: str, title: str, frequency: str, start_date: str, execution_day: int, category_id: str | None = None):
    async with user_session() as (s, user_id): return clean((await FinanceService(s, user_id).create_recurring(RecurringCreate(account_id=account_id, type=transaction_type, amount=Decimal(amount), title=title, frequency=frequency, start_date=date.fromisoformat(start_date), execution_day=execution_day, category_id=category_id))).__dict__)


@mcp.tool(description="Update a recurring transaction by exact ID.")
async def update_recurring_transaction(recurring_id: str, amount: str | None = None, title: str | None = None):
    async with user_session() as (s, user_id): return clean((await FinanceService(s, user_id).update_recurring(uuid.UUID(recurring_id), RecurringUpdate(amount=Decimal(amount) if amount else None, title=title))).__dict__)


async def _toggle_or_delete(recurring_id: str, action: str):
    from sqlalchemy import delete
    from app.models.entities import RecurringTransaction
    async with user_session() as (s, user_id):
        item = await s.scalar(select(RecurringTransaction).where(RecurringTransaction.id == uuid.UUID(recurring_id), RecurringTransaction.user_id == user_id))
        if not item: return {"error": "not_found"}
        if action == "delete": await s.execute(delete(RecurringTransaction).where(RecurringTransaction.id == item.id))
        else: item.enabled = action == "enable"
        await s.commit(); return {action + "d": recurring_id}


@mcp.tool(description="Delete a recurring rule by exact ID.")
async def delete_recurring_transaction(recurring_id: str): return await _toggle_or_delete(recurring_id, "delete")


@mcp.tool(description="Enable a recurring rule by exact ID.")
async def enable_recurring_transaction(recurring_id: str): return await _toggle_or_delete(recurring_id, "enable")


@mcp.tool(description="Disable a recurring rule by exact ID.")
async def disable_recurring_transaction(recurring_id: str): return await _toggle_or_delete(recurring_id, "disable")


@mcp.tool(description="Get current total assets and per-account balances.")
async def get_current_assets():
    async with user_session() as (s, user_id): return clean(await FinanceService(s, user_id).dashboard())


@mcp.tool(description="Get calculated total asset history for a date range.")
async def get_asset_history(start: str, end: str, interval: str = "monthly"):
    async with user_session() as (s, user_id): return clean(await AnalyticsService(s, user_id).asset_history(date.fromisoformat(start), date.fromisoformat(end), interval))


@mcp.tool(description="Get income, expenses, and net savings for daily, monthly, or yearly periods.")
async def get_cashflow_summary(start: str, end: str, interval: str = "monthly"):
    async with user_session() as (s, user_id): return clean(await AnalyticsService(s, user_id).cashflow(date.fromisoformat(start), date.fromisoformat(end), interval))


@mcp.tool(description="Rank spending categories for the requested date range.")
async def get_category_spending(start: str, end: str):
    async with user_session() as (s, user_id): return clean(await AnalyticsService(s, user_id).category_spending(date.fromisoformat(start), date.fromisoformat(end)))


@mcp.tool(description="Get the complete dashboard summary: assets, current month cashflow, accounts, and recent transactions.")
async def get_dashboard_summary(): return await get_current_assets()


if __name__ == "__main__": mcp.run()
