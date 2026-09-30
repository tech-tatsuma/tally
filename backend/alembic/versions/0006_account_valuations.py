"""add investment account valuation history"""

from alembic import op
import sqlalchemy as sa

revision = "0006_account_valuations"
down_revision = "0005_credit_closing_day"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "account_valuations" in inspector.get_table_names():
        return
    op.create_table(
        "account_valuations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("valued_on", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("account_id", "valued_on", name="uq_account_valuations_account_day"),
    )
    op.create_index("ix_account_valuations_user_id", "account_valuations", ["user_id"])
    op.create_index("ix_account_valuations_account_id", "account_valuations", ["account_id"])
    op.create_index("ix_account_valuations_valued_on", "account_valuations", ["valued_on"])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "account_valuations" not in inspector.get_table_names():
        return
    op.drop_index("ix_account_valuations_valued_on", table_name="account_valuations")
    op.drop_index("ix_account_valuations_account_id", table_name="account_valuations")
    op.drop_index("ix_account_valuations_user_id", table_name="account_valuations")
    op.drop_table("account_valuations")
