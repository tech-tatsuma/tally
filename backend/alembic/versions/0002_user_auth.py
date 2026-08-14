"""add multi-user authentication and MCP tokens"""
from alembic import op
import sqlalchemy as sa

revision = "0002_user_auth"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    role = sa.Enum("admin", "user", name="userrole")
    role.create(bind, checkfirst=True)
    additions = [
        ("password_hash", sa.Column("password_hash", sa.String(255), nullable=True)),
        ("role", sa.Column("role", role, nullable=False, server_default="user")),
        ("is_active", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true())),
        ("timezone", sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Tokyo")),
        ("currency", sa.Column("currency", sa.String(3), nullable=False, server_default="JPY")),
    ]
    for name, column in additions:
        if name not in user_columns:
            op.add_column("users", column)
    existing_user_indexes = {index["name"] for index in inspector.get_indexes("users")}
    if "ix_users_role" not in existing_user_indexes: op.create_index("ix_users_role", "users", ["role"])
    if "ix_users_is_active" not in existing_user_indexes: op.create_index("ix_users_is_active", "users", ["is_active"])
    op.execute("UPDATE users SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000001' AND role = 'user'")

    for name, columns in [
        ("user_sessions", [
            sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False), sa.Column("revoked_at", sa.DateTime(timezone=True)),
        ]),
        ("password_reset_tokens", [
            sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("used_at", sa.DateTime(timezone=True)),
        ]),
        ("api_tokens", [
            sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False), sa.Column("token_hash", sa.String(64), nullable=False), sa.Column("token_prefix", sa.String(16), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True)), sa.Column("expires_at", sa.DateTime(timezone=True)), sa.Column("revoked_at", sa.DateTime(timezone=True)),
        ]),
    ]:
        if not inspector.has_table(name):
            op.create_table(name, *columns, sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
            op.create_index(f"ix_{name}_user_id", name, ["user_id"])
            op.create_index(f"ix_{name}_token_hash", name, ["token_hash"], unique=True)
            op.create_index(f"ix_{name}_expires_at", name, ["expires_at"])
            if name == "api_tokens": op.create_index("ix_api_tokens_token_prefix", "api_tokens", ["token_prefix"])


def downgrade():
    op.drop_index("ix_api_tokens_token_prefix", table_name="api_tokens")
    for name in ["api_tokens", "password_reset_tokens", "user_sessions"]:
        op.drop_table(name)
    op.drop_index("ix_users_is_active", table_name="users")
    op.drop_index("ix_users_role", table_name="users")
    for column in ["currency", "timezone", "is_active", "role", "password_hash"]:
        op.drop_column("users", column)
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)
