"""add credit card closing day and payment month offset"""

from alembic import op
import sqlalchemy as sa

revision = "0005_credit_closing_day"
down_revision = "0004_mcp_connections"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    account_columns = {column["name"] for column in inspector.get_columns("accounts")}
    if "credit_closing_day" not in account_columns:
        op.add_column("accounts", sa.Column("credit_closing_day", sa.Integer(), nullable=True))
    if "credit_payment_month_offset" not in account_columns:
        op.add_column("accounts", sa.Column("credit_payment_month_offset", sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE accounts SET credit_closing_day = 31, credit_payment_month_offset = 1 "
            "WHERE credit_payment_day IS NOT NULL AND credit_payment_account_id IS NOT NULL"
        )
    )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    account_columns = {column["name"] for column in inspector.get_columns("accounts")}
    if "credit_payment_month_offset" in account_columns:
        op.drop_column("accounts", "credit_payment_month_offset")
    if "credit_closing_day" in account_columns:
        op.drop_column("accounts", "credit_closing_day")
