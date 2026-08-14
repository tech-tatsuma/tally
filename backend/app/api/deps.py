import uuid
from typing import Annotated

from fastapi import Header

from app.core.config import get_settings


async def current_user_id(x_user_id: Annotated[str | None, Header()] = None) -> uuid.UUID:
    """MVP identity boundary; replace this dependency with real authentication later."""
    return uuid.UUID(x_user_id or get_settings().default_user_id)

