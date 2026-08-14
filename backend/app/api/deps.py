import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import token_hash
from app.db.session import get_session
from app.models.entities import ApiToken, User, UserRole, UserSession


async def current_user(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
    session_cookie: Annotated[str | None, Cookie(alias="tally_session")] = None,
) -> User:
    settings = get_settings()
    raw = authorization.removeprefix("Bearer ").strip() if authorization and authorization.startswith("Bearer ") else session_cookie
    if not raw:
        raise HTTPException(401, "Authentication required")
    now = datetime.now(timezone.utc)
    user = None
    if raw.startswith("tlly_mcp_"):
        api_token = await session.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash(raw), ApiToken.revoked_at.is_(None)))
        if api_token and (not api_token.expires_at or (api_token.expires_at if api_token.expires_at.tzinfo else api_token.expires_at.replace(tzinfo=timezone.utc)) > now):
            api_token.last_used_at = now
            user = await session.get(User, api_token.user_id)
    else:
        login = await session.scalar(select(UserSession).where(UserSession.token_hash == token_hash(raw), UserSession.revoked_at.is_(None)))
        if login and (login.expires_at if login.expires_at.tzinfo else login.expires_at.replace(tzinfo=timezone.utc)) > now:
            login.last_used_at = now
            user = await session.get(User, login.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Session is invalid or expired")
    await session.commit()
    return user


async def current_user_id(user: Annotated[User, Depends(current_user)]) -> uuid.UUID:
    return user.id


async def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(403, "Administrator permission is required")
    return user
