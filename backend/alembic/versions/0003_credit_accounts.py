"""add credit account auto-payment support"""
from alembic import op
import sqlalchemy as sa

revision = "0003_credit_accounts"
down_revision = "0002_user_auth"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE accounttype ADD VALUE IF NOT EXISTS 'credit'")

    account_columns = {column["name"] for column in inspector.get_columns("accounts")}
    if "credit_payment_day" not in account_columns:
        op.add_column("accounts", sa.Column("credit_payment_day", sa.Integer(), nullable=True))
    if "credit_payment_account_id" not in account_columns:
        op.add_column("accounts", sa.Column("credit_payment_account_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_accounts_credit_payment_account_id_accounts", "accounts", "accounts",
            ["credit_payment_account_id"], ["id"], deferrable=True, initially="DEFERRED",
        )

    if not inspector.has_table("credit_settlements"):
        op.create_table(
            "credit_settlements",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("credit_account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
            sa.Column("payment_account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
            sa.Column("period_key", sa.String(10), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("transfer_group_id", sa.Uuid(), nullable=True),
            sa.Column("settled_on", sa.Date(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_credit_settlements_user_id", "credit_settlements", ["user_id"])
        op.create_index("ix_credit_settlements_credit_account_id", "credit_settlements", ["credit_account_id"])
        op.create_index("ix_credit_settlements_transfer_group_id", "credit_settlements", ["transfer_group_id"])
        op.create_unique_constraint("uq_credit_settlements_credit_account_id", "credit_settlements", ["credit_account_id", "period_key"])

    transaction_columns = {column["name"] for column in inspector.get_columns("transactions")}
    if "credit_settlement_id" not in transaction_columns:
        op.add_column("transactions", sa.Column("credit_settlement_id", sa.Uuid(), sa.ForeignKey("credit_settlements.id"), nullable=True))
        op.create_index("ix_transactions_credit_settlement_id", "transactions", ["credit_settlement_id"])


def downgrade():
    # Postgres has no ALTER TYPE ... DROP VALUE, so the 'credit' accounttype enum value is left in place.
    op.drop_index("ix_transactions_credit_settlement_id", table_name="transactions")
    op.drop_column("transactions", "credit_settlement_id")
    op.drop_table("credit_settlements")
    op.drop_constraint("fk_accounts_credit_payment_account_id_accounts", "accounts", type_="foreignkey")
    op.drop_column("accounts", "credit_payment_account_id")
    op.drop_column("accounts", "credit_payment_day")
