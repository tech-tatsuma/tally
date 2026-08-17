from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine
from app.mcp.server import mcp

mcp_app = mcp.http_app(path="/{connection_key}", transport="streamable-http")

@asynccontextmanager
async def lifespan(_: FastAPI):
    # The mounted FastMCP app owns the Streamable HTTP session manager lifespan.
    async with mcp_app.router.lifespan_context(mcp_app):
        if get_settings().app_env == "development":
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        yield


app = FastAPI(title="Tally API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router, prefix="/api/v1")
# Each URL below contains a user-specific, revocable capability. The FastMCP app
# resolves it from the path for every tool call; no Authorization header is used.
app.mount("/mcp", mcp_app)


@app.get("/health")
async def health(): return {"status": "ok"}
