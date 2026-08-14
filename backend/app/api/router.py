import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, current_user_id, require_admin
from app.core.config import get_settings
from app.db.session import get_session
from app.models.entities import ApiToken, Category, RecurringTransaction, TransactionType, User, UserRole
from app.repositories.finance import FinanceRepository
from app.schemas.common import AccountCreate, AccountRead, AccountUpdate, CategoryCreate, CategoryRead, RecurringCreate, RecurringRead, RecurringUpdate, TransactionCreate, TransactionPage, TransactionRead, TransactionUpdate
from app.services.analytics import AnalyticsService
from app.services.backup import BackupService
from app.services.finance import FinanceService
from app.services.auth import AuthService
from app.schemas.auth import AdminUserUpdate, ApiTokenCreate, ApiTokenCreated, ApiTokenRead, ForgotPasswordRequest, LoginRequest, PasswordChangeRequest, ProfileUpdate, RegisterRequest, ResetPasswordRequest, UserRead

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_session)]
UserId = Annotated[uuid.UUID, Depends(current_user_id)]
CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(require_admin)]


def set_session_cookie(response: Response, token: str, remember_me: bool) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=(settings.session_days if remember_me else 1) * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/auth/register", response_model=UserRead, status_code=201)
async def register(data: RegisterRequest, response: Response, session: Session):
    service = AuthService(session)
    user = await service.register(data.name, data.email, data.password)
    raw, _ = await service.create_session(user, True)
    set_session_cookie(response, raw, True)
    return user


@router.post("/auth/login", response_model=UserRead)
async def login(data: LoginRequest, response: Response, session: Session):
    service = AuthService(session)
    user = await service.authenticate(data.email, data.password)
    raw, _ = await service.create_session(user, data.remember_me)
    set_session_cookie(response, raw, data.remember_me)
    return user


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, session: Session):
    settings = get_settings()
    await AuthService(session).revoke_session(request.cookies.get(settings.cookie_name))
    response.delete_cookie(settings.cookie_name, path="/")
    response.status_code = 204
    return response


@router.get("/auth/me", response_model=UserRead)
async def me(user: CurrentUser): return user


@router.patch("/auth/me", response_model=UserRead)
async def update_profile(data: ProfileUpdate, user: CurrentUser, session: Session):
    for key, value in data.model_dump(exclude_unset=True).items(): setattr(user, key, value)
    await session.commit(); await session.refresh(user); return user


@router.post("/auth/change-password", status_code=204)
async def change_password(data: PasswordChangeRequest, user: CurrentUser, session: Session):
    await AuthService(session).change_password(user, data.current_password, data.new_password)
    return Response(status_code=204)


@router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPasswordRequest, session: Session):
    token = await AuthService(session).request_password_reset(data.email)
    payload = {"message": "If the account exists, password reset instructions have been sent."}
    if token and get_settings().app_env != "production": payload["debug_reset_token"] = token
    return payload


@router.post("/auth/reset-password", status_code=204)
async def reset_password(data: ResetPasswordRequest, session: Session):
    await AuthService(session).reset_password(data.token, data.new_password)
    return Response(status_code=204)


@router.get("/auth/api-tokens", response_model=list[ApiTokenRead])
async def list_api_tokens(user: CurrentUser, session: Session):
    return list(await session.scalars(select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None)).order_by(ApiToken.created_at.desc())))


@router.post("/auth/api-tokens", response_model=ApiTokenCreated, status_code=201)
async def create_api_token(data: ApiTokenCreate, user: CurrentUser, session: Session):
    item, raw = await AuthService(session).create_api_token(user, data.name, data.expires_in_days)
    return {**item.__dict__, "token": raw}


@router.delete("/auth/api-tokens/{token_id}", status_code=204)
async def revoke_api_token(token_id: uuid.UUID, user: CurrentUser, session: Session):
    result = await session.execute(update(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None)).values(revoked_at=datetime.now().astimezone()))
    if not result.rowcount:
        from fastapi import HTTPException
        raise HTTPException(404, "API token not found")
    await session.commit(); return Response(status_code=204)


@router.get("/admin/users", response_model=list[UserRead])
async def list_users(_: AdminUser, session: Session):
    return list(await session.scalars(select(User).order_by(User.created_at)))


@router.patch("/admin/users/{target_id}", response_model=UserRead)
async def update_user(target_id: uuid.UUID, data: AdminUserUpdate, admin: AdminUser, session: Session):
    from fastapi import HTTPException
    target = await session.get(User, target_id)
    if not target: raise HTTPException(404, "User not found")
    if target.id == admin.id and data.is_active is False: raise HTTPException(409, "You cannot disable your own account")
    if target.role == UserRole.admin and data.role == UserRole.user:
        admin_count = await session.scalar(select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active.is_(True))) or 0
        if admin_count <= 1: raise HTTPException(409, "At least one active administrator is required")
    for key, value in data.model_dump(exclude_unset=True).items(): setattr(target, key, value)
    await session.commit(); await session.refresh(target); return target


@router.get("/accounts", response_model=list[AccountRead])
async def list_accounts(session: Session, user_id: UserId, include_archived: bool = False): return await FinanceService(session, user_id).list_accounts(include_archived)


@router.post("/accounts", response_model=AccountRead, status_code=201)
async def create_account(data: AccountCreate, session: Session, user_id: UserId): return await FinanceService(session, user_id).create_account(data)


@router.get("/accounts/{account_id}", response_model=AccountRead)
async def get_account(account_id: uuid.UUID, session: Session, user_id: UserId): return await FinanceService(session, user_id).get_account(account_id)


@router.patch("/accounts/{account_id}", response_model=AccountRead)
async def update_account(account_id: uuid.UUID, data: AccountUpdate, session: Session, user_id: UserId): return await FinanceService(session, user_id).update_account(account_id, data)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: uuid.UUID, session: Session, user_id: UserId): await FinanceService(session, user_id).archive_account(account_id); return Response(status_code=204)


@router.get("/accounts/{account_id}/balance")
async def get_account_balance(account_id: uuid.UUID, session: Session, user_id: UserId):
    account = await FinanceService(session, user_id).get_account(account_id); return {"account_id": account_id, "balance": account["current_balance"], "currency": account["currency"]}


@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(session: Session, user_id: UserId, type: str | None = None):
    query = select(Category).where(Category.user_id == user_id)
    if type: query = query.where(Category.type == type)
    return list(await session.scalars(query.order_by(Category.name)))


@router.post("/categories", response_model=CategoryRead, status_code=201)
async def create_category(data: CategoryCreate, session: Session, user_id: UserId):
    category = Category(user_id=user_id, **data.model_dump()); session.add(category); await session.commit(); await session.refresh(category); return category


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: uuid.UUID, session: Session, user_id: UserId):
    in_use = await session.scalar(select(Category.id).join(Category, isouter=True)) if False else None
    await session.execute(delete(Category).where(Category.id == category_id, Category.user_id == user_id)); await session.commit(); return Response(status_code=204)


@router.get("/transactions", response_model=TransactionPage)
async def list_transactions(session: Session, user_id: UserId, start: datetime | None = None, end: datetime | None = None, account_id: uuid.UUID | None = None, category_id: uuid.UUID | None = None, type: TransactionType | None = None, keyword: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    items, total = await FinanceRepository(session).list_transactions(user_id, start=start, end=end, account_id=account_id, category_id=category_id, type_=type, keyword=keyword, page=page, page_size=page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/transactions", response_model=TransactionRead, status_code=201)
async def create_transaction(data: TransactionCreate, session: Session, user_id: UserId): return await FinanceService(session, user_id).create_transaction(data)


@router.get("/transactions/{transaction_id}", response_model=TransactionRead)
async def get_transaction(transaction_id: uuid.UUID, session: Session, user_id: UserId):
    tx = await FinanceRepository(session).transaction(user_id, transaction_id)
    if not tx:
        from fastapi import HTTPException
        raise HTTPException(404, "Transaction not found")
    return tx


@router.patch("/transactions/{transaction_id}", response_model=TransactionRead)
async def update_transaction(transaction_id: uuid.UUID, data: TransactionUpdate, session: Session, user_id: UserId): return await FinanceService(session, user_id).update_transaction(transaction_id, data)


@router.delete("/transactions/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: uuid.UUID, session: Session, user_id: UserId): await FinanceService(session, user_id).delete_transaction(transaction_id); return Response(status_code=204)


@router.get("/recurring-transactions", response_model=list[RecurringRead])
async def list_recurring(session: Session, user_id: UserId): return list(await session.scalars(select(RecurringTransaction).where(RecurringTransaction.user_id == user_id).order_by(RecurringTransaction.next_execution_date)))


@router.post("/recurring-transactions", response_model=RecurringRead, status_code=201)
async def create_recurring(data: RecurringCreate, session: Session, user_id: UserId): return await FinanceService(session, user_id).create_recurring(data)


@router.patch("/recurring-transactions/{recurring_id}", response_model=RecurringRead)
async def update_recurring(recurring_id: uuid.UUID, data: RecurringUpdate, session: Session, user_id: UserId): return await FinanceService(session, user_id).update_recurring(recurring_id, data)


@router.delete("/recurring-transactions/{recurring_id}", status_code=204)
async def delete_recurring(recurring_id: uuid.UUID, session: Session, user_id: UserId): await session.execute(delete(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.user_id == user_id)); await session.commit(); return Response(status_code=204)


@router.post("/recurring-transactions/{recurring_id}/{action}", response_model=RecurringRead)
async def toggle_recurring(recurring_id: uuid.UUID, action: str, session: Session, user_id: UserId):
    from fastapi import HTTPException
    if action not in {"enable", "disable"}: raise HTTPException(404)
    item = await session.scalar(select(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.user_id == user_id))
    if not item: raise HTTPException(404, "Recurring transaction not found")
    item.enabled = action == "enable"; await session.commit(); await session.refresh(item); return item


@router.post("/recurring-transactions/process")
async def process_recurring(session: Session, user_id: UserId, target_date: date = Query(default_factory=date.today)): return {"created": await FinanceService(session, user_id).process_due_recurring_transactions(target_date)}


@router.get("/dashboard")
async def dashboard(session: Session, user_id: UserId): return await FinanceService(session, user_id).dashboard()


@router.get("/analytics/cashflow")
async def cashflow(session: Session, user_id: UserId, from_: date = Query(alias="from"), to: date = Query(), interval: str = Query("monthly", pattern="^(daily|monthly|yearly)$")): return await AnalyticsService(session, user_id).cashflow(from_, to, interval)


@router.get("/analytics/assets")
async def assets(session: Session, user_id: UserId, from_: date = Query(alias="from"), to: date = Query(), interval: str = Query("monthly", pattern="^(daily|monthly|yearly)$")): return await AnalyticsService(session, user_id).asset_history(from_, to, interval)


@router.get("/analytics/categories")
async def categories(session: Session, user_id: UserId, from_: date = Query(alias="from"), to: date = Query()): return await AnalyticsService(session, user_id).category_spending(from_, to)


@router.get("/backup")
async def export_backup(session: Session, user: AdminUser): return await BackupService(session, user.id).export()


@router.post("/backup/restore")
async def restore_backup(session: Session, user: AdminUser, payload: dict = Body(), confirm: bool = Query(False)):
    from fastapi import HTTPException
    if not confirm: raise HTTPException(409, "Set confirm=true after reviewing the backup; restore replaces current data")
    return await BackupService(session, user.id).restore(payload)


@router.delete("/admin/data", status_code=200)
async def delete_all_finance_data(session: Session, user: AdminUser, confirm: bool = Query(False)):
    from fastapi import HTTPException
    if not confirm: raise HTTPException(409, "Set confirm=true to delete all finance data")
    return await BackupService(session, user.id).delete_all()
