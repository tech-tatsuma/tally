from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import verify_password
from app.models.entities import Account, AccountType, ApiToken, Category, McpConnection, User, UserRole, UserSession
from app.services.auth import STARTER_CATEGORIES, AuthService
from app.services.finance import FinanceService


async def test_register_login_profile_and_persistent_session(session):
    auth = AuthService(session)
    user = await auth.register("Second user", "SECOND@example.com", "StrongPassword123")
    assert user.email == "second@example.com"
    assert user.role == UserRole.user
    assert (await session.scalar(select(Account).where(Account.user_id == user.id))) is None
    names = {c.name for c in (await session.scalars(select(Category).where(Category.user_id == user.id)))}
    colors = [c.color for c in (await session.scalars(select(Category).where(Category.user_id == user.id)))]
    assert "食費" in names
    assert "給与" in names
    assert len(colors) == len(set(colors))
    assert (await auth.authenticate("second@example.com", "StrongPassword123")).id == user.id
    raw, login = await auth.create_session(user, remember_me=True)
    assert raw.startswith("tlly_sess_")
    assert (login.expires_at.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days >= 29


def test_starter_categories_use_unique_colors():
    colors = [color for _, _, color in STARTER_CATEGORIES]
    assert len(colors) == len(set(colors))
    assert len(colors) >= 7


async def test_admin_email_from_settings_becomes_administrator(session):
    auth = AuthService(session)
    previous = auth.settings.admin_email
    auth.settings.admin_email = "Owner@example.com"
    try:
        first = await auth.register("First", "someone@example.com", "StrongPassword123")
        admin = await auth.register("Owner", "owner@example.com", "StrongPassword123")
        assert first.role == UserRole.user
        assert admin.role == UserRole.admin
    finally:
        auth.settings.admin_email = previous


async def test_password_reset_is_one_time_and_revokes_sessions(session):
    auth = AuthService(session)
    user = await session.scalar(select(User).where(User.email == "test@example.com"))
    raw_session, _ = await auth.create_session(user)
    reset = await auth.request_password_reset(user.email)
    await auth.reset_password(reset, "UpdatedPassword123")
    assert verify_password("UpdatedPassword123", user.password_hash)
    login = await session.scalar(select(UserSession).where(UserSession.user_id == user.id))
    assert login.revoked_at is not None
    try:
        await auth.reset_password(reset, "AnotherPassword123")
        assert False, "reset token must be one-time"
    except HTTPException as exc:
        assert exc.status_code == 400


async def test_api_tokens_and_finance_are_user_scoped(session):
    auth = AuthService(session)
    second = await auth.register("Second", "second@example.com", "StrongPassword123")
    token, raw = await auth.create_api_token(second, "MCP", 30)
    assert raw.startswith("tlly_mcp_")
    assert await session.scalar(select(ApiToken).where(ApiToken.user_id == second.id, ApiToken.id == token.id))

    session.add(Account(user_id=second.id, name="Private", account_type=AccountType.bank, initial_balance=500))
    await session.commit()
    first_accounts = await FinanceService(session, (await session.scalar(select(User).where(User.email == "test@example.com"))).id).list_accounts()
    second_accounts = await FinanceService(session, second.id).list_accounts()
    assert {a["name"] for a in first_accounts} == {"Main", "Savings"}
    assert {a["name"] for a in second_accounts} == {"Private"}


async def test_mcp_connection_url_is_rotated_and_user_scoped(session):
    auth = AuthService(session)
    user = await auth.register("MCP user", "mcp-user@example.com", "StrongPassword123")
    first, first_secret = await auth.rotate_mcp_connection(user)
    second, second_secret = await auth.rotate_mcp_connection(user)

    assert first_secret.startswith("tlly_mcpurl_")
    assert second_secret.startswith("tlly_mcpurl_")
    assert first_secret != second_secret
    assert first.revoked_at is not None
    assert second.revoked_at is None
    active = await session.scalar(
        select(McpConnection).where(McpConnection.user_id == user.id, McpConnection.revoked_at.is_(None))
    )
    assert active.id == second.id
