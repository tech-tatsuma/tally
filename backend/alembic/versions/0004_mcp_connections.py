"""add per-user Streamable HTTP MCP capability URLs"""

from alembic import op
import sqlalchemy as sa


revision = "0004_mcp_connections"
down_revision = "0003_credit_accounts"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("mcp_connections"):
        return
    op.create_table(
        "mcp_connections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=False),
        sa.Column("secret_prefix", sa.String(18), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mcp_connections_user_id", "mcp_connections", ["user_id"])
    op.create_index("ix_mcp_connections_secret_hash", "mcp_connections", ["secret_hash"], unique=True)
    op.create_index("ix_mcp_connections_secret_prefix", "mcp_connections", ["secret_prefix"])
    op.create_index("ix_mcp_connections_revoked_at", "mcp_connections", ["revoked_at"])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("mcp_connections"):
        op.drop_table("mcp_connections")
