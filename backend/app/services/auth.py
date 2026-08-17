import asyncio
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password, new_token, token_hash, valid_password, verify_password
from app.models.entities import Account, AccountType, ApiToken, PasswordResetToken, User, UserRole, UserSession


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.settings = get_settings()

    def _role_for_email(self, email: str) -> UserRole:
        configured = (self.settings.admin_email or "").strip().lower()
        return UserRole.admin if configured and configured == email else UserRole.user

    async def register(self, name: str, email: str, password: str) -> User:
        email = email.strip().lower()
        if not valid_password(password):
            raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
        if await self.session.scalar(select(User.id).where(func.lower(User.email) == email)):
            raise HTTPException(409, "An account with this email already exists")
        user = User(name=name.strip(), email=email, password_hash=hash_password(password), role=self._role_for_email(email))
        self.session.add(user)
        await self.session.flush()
        # Every household starts with a place to record the cash it carries.
        self.session.add(Account(
            user_id=user.id,
            name="お財布",
            account_type=AccountType.cash,
            initial_balance=Decimal("0"),
            currency=user.currency,
        ))
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def authenticate(self, email: str, password: str) -> User:
        user = await self.session.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(401, "Email or password is incorrect")
        if not user.is_active:
            raise HTTPException(403, "This account is disabled")
        return user

    async def create_session(self, user: User, remember_me: bool = True) -> tuple[str, UserSession]:
        raw = new_token("tlly_sess_")
        duration = timedelta(days=self.settings.session_days if remember_me else 1)
        record = UserSession(user_id=user.id, token_hash=token_hash(raw), expires_at=datetime.now(timezone.utc) + duration)
        self.session.add(record)
        await self.session.commit()
        await self.session.refresh(record)
        return raw, record

    async def revoke_session(self, raw: str | None) -> None:
        if raw:
            await self.session.execute(update(UserSession).where(UserSession.token_hash == token_hash(raw), UserSession.revoked_at.is_(None)).values(revoked_at=datetime.now(timezone.utc)))
            await self.session.commit()

    async def request_password_reset(self, email: str) -> str | None:
        user = await self.session.scalar(select(User).where(func.lower(User.email) == email.strip().lower(), User.is_active.is_(True)))
        if not user:
            return None
        raw = new_token("tlly_reset_")
        expires = datetime.now(timezone.utc) + timedelta(minutes=self.settings.password_reset_minutes)
        self.session.add(PasswordResetToken(user_id=user.id, token_hash=token_hash(raw), expires_at=expires))
        await self.session.commit()
        if self.settings.smtp_host and self.settings.smtp_from:
            await asyncio.to_thread(self._send_reset_email, user.email, user.name, raw)
        return raw

    def _send_reset_email(self, address: str, name: str, token: str) -> None:
        link = f"{self.settings.frontend_url.rstrip('/')}/reset-password?token={token}"
        message = EmailMessage()
        message["Subject"] = "tally パスワード再設定"
        message["From"] = self.settings.smtp_from
        message["To"] = address
        message.set_content(f"{name}さん\n\n次のリンクから{self.settings.password_reset_minutes}分以内にパスワードを再設定してください。\n{link}\n\n心当たりがない場合は、このメールを無視してください。")
        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
            if self.settings.smtp_starttls:
                smtp.starttls()
            if self.settings.smtp_username:
                smtp.login(self.settings.smtp_username, self.settings.smtp_password or "")
            smtp.send_message(message)

    async def reset_password(self, raw: str, password: str) -> User:
        if not valid_password(password):
            raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
        now = datetime.now(timezone.utc)
        record = await self.session.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash(raw), PasswordResetToken.used_at.is_(None)))
        if not record or _aware(record.expires_at) <= now:
            raise HTTPException(400, "Reset link is invalid or expired")
        user = await self.session.get(User, record.user_id)
        if not user or not user.is_active:
            raise HTTPException(400, "Reset link is invalid or expired")
        user.password_hash = hash_password(password)
        record.used_at = now
        await self.session.execute(update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).values(revoked_at=now))
        await self.session.commit()
        return user

    async def change_password(self, user: User, current: str, new: str) -> None:
        if not verify_password(current, user.password_hash):
            raise HTTPException(400, "Current password is incorrect")
        if not valid_password(new):
            raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
        user.password_hash = hash_password(new)
        await self.session.commit()

    async def create_api_token(self, user: User, name: str, days: int | None) -> tuple[ApiToken, str]:
        raw = new_token("tlly_mcp_")
        expires = datetime.now(timezone.utc) + timedelta(days=days) if days else None
        item = ApiToken(user_id=user.id, name=name.strip(), token_hash=token_hash(raw), token_prefix=raw[:14], expires_at=expires)
        self.session.add(item)
        await self.session.commit()
        await self.session.refresh(item)
        return item, raw
