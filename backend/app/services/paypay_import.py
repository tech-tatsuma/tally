import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, AccountType, Transaction

JST = ZoneInfo("Asia/Tokyo")


def _amount(value: str | None) -> Decimal:
    cleaned = (value or "").replace(",", "").strip()
    if not cleaned or cleaned == "-": return Decimal("0")
    try: return Decimal(cleaned)
    except InvalidOperation as error: raise HTTPException(422, "PayPay CSV contains an invalid amount") from error


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp932"):
        try: return content.decode(encoding)
        except UnicodeDecodeError: continue
    raise HTTPException(422, "PayPay CSV must be UTF-8 or Shift_JIS encoded")


async def preview_paypay_import(session: AsyncSession, user_id, account: Account, content: bytes) -> list[dict]:
    """Parse PayPay's export and return only rows appropriate for this account."""
    if account.account_type not in {AccountType.credit, AccountType.wallet}:
        raise HTTPException(422, "PayPay CSV import is available for credit cards and e-money accounts")
    rows = csv.DictReader(io.StringIO(_decode(content)))
    required = {"取引日", "出金金額（円）", "入金金額（円）", "取引内容", "取引先", "取引方法"}
    if not rows.fieldnames or not required.issubset(set(rows.fieldnames)):
        raise HTTPException(422, "This does not look like a PayPay transaction-history CSV")
    existing = list(await session.scalars(select(Transaction).where(Transaction.user_id == user_id, Transaction.account_id == account.id)))
    candidates = []
    for row in rows:
        method, detail = (row.get("取引方法") or "").strip(), (row.get("取引内容") or "").strip()
        is_charge, card_row, wallet_row = detail == "チャージ", "PayPayカード" in method or "クレジット" in method, method == "PayPay残高"
        if account.account_type == AccountType.credit and not card_row: continue
        if account.account_type == AccountType.wallet and not (wallet_row or is_charge): continue
        try: occurred_at = datetime.strptime((row.get("取引日") or "").strip(), "%Y/%m/%d %H:%M:%S").replace(tzinfo=JST)
        except ValueError as error: raise HTTPException(422, "PayPay CSV contains an invalid transaction date") from error
        outgoing, incoming = _amount(row.get("出金金額（円）")), _amount(row.get("入金金額（円）"))
        amount = incoming if is_charge or incoming else outgoing
        if amount <= 0: continue
        kind, type_ = ("transfer", "transfer") if is_charge else ("transaction", "income" if incoming else "expense")
        duplicate = next((tx for tx in existing if Decimal(tx.amount) == amount and tx.occurred_at.astimezone(JST).date() == occurred_at.date()), None)
        candidates.append({"source_id": (row.get("取引番号") or f"{occurred_at.isoformat()}:{amount}:{detail}").strip(), "occurred_at": occurred_at.isoformat(), "amount": str(amount), "title": (row.get("取引先") or detail or "PayPay取引").strip(), "description": f"PayPay CSV / {detail} / {method}".strip(" /"), "type": type_, "kind": kind, "transaction_method": method, "duplicate": duplicate is not None, "duplicate_transaction_id": str(duplicate.id) if duplicate else None, "duplicate_title": duplicate.title if duplicate else None})
    return candidates
