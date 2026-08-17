import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Account, Category, CreditSettlement, RecurringTransaction, Transaction


TABLES = [Account, Category, CreditSettlement, RecurringTransaction, Transaction]


def json_value(value):
    if isinstance(value, (datetime, Decimal, uuid.UUID)): return str(value)
    if hasattr(value, "value"): return value.value
    return value


def database_value(column, value):
    """Convert portable JSON scalars back to the model's database-safe Python type."""
    if value is None:
        return None
    enum_class = getattr(column.type, "enum_class", None)
    if enum_class:
        return enum_class(value)
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        return value
    if python_type is uuid.UUID:
        return uuid.UUID(value)
    if python_type is Decimal:
        return Decimal(value)
    if python_type is datetime:
        return datetime.fromisoformat(value)
    if python_type is date:
        return date.fromisoformat(value)
    return value


class BackupEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(ge=1, le=1)
    exported_at: datetime
    data: dict[str, list[dict]]


class BackupService:
    def __init__(self, session: AsyncSession, user_id: uuid.UUID): self.session, self.user_id = session, user_id

    async def export(self) -> dict:
        data = {}
        for model in TABLES:
            rows = list(await self.session.scalars(select(model).where(model.user_id == self.user_id)))
            data[model.__tablename__] = [{c.name: json_value(getattr(row, c.name)) for c in model.__table__.columns if c.name != "user_id"} for row in rows]
        return {"schema_version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "data": data}

    async def restore(self, payload: dict) -> dict:
        try: envelope = BackupEnvelope.model_validate(payload)
        except Exception as exc: raise HTTPException(422, f"Invalid backup: {exc}") from exc
        required = {m.__tablename__ for m in TABLES}
        if set(envelope.data) != required: raise HTTPException(422, "Backup tables do not match this version")
        try:
            for model in reversed(TABLES): await self.session.execute(delete(model).where(model.user_id == self.user_id))
            counts = {}
            for model in TABLES:
                rows = envelope.data[model.__tablename__]; counts[model.__tablename__] = len(rows)
                for row in rows:
                    values = {
                        k: database_value(model.__table__.columns[k], v)
                        for k, v in row.items()
                        if k in model.__table__.columns.keys()
                    }
                    values["user_id"] = self.user_id
                    self.session.add(model(**values))
                await self.session.flush()
            await self.session.commit(); return {"restored": counts, "schema_version": envelope.schema_version}
        except Exception as exc:
            await self.session.rollback(); raise HTTPException(422, f"Backup could not be restored: {exc}") from exc

    async def delete_all(self) -> dict:
        counts = {}
        for model in reversed(TABLES):
            result = await self.session.execute(delete(model).where(model.user_id == self.user_id))
            counts[model.__tablename__] = result.rowcount or 0
        await self.session.commit()
        return {"deleted": counts}
