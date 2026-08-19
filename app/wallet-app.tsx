"use client";
/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions, no-irregular-whitespace */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Account = {
  id: string;
  name: string;
  institution_name?: string;
  account_type: string;
  current_balance: number;
  initial_balance?: number;
  currency: string;
  description?: string;
  credit_closing_day?: number | null;
  credit_payment_day?: number | null;
  credit_payment_month_offset?: number | null;
  credit_payment_account_id?: string | null;
};
type Category = {
  id: string;
  name: string;
  type: "income" | "expense";
  color?: string;
};
type Transaction = {
  id: string;
  account_id: string;
  category_id?: string;
  type: "income" | "expense" | "transfer";
  amount: number;
  occurred_at: string;
  title: string;
  description?: string;
  journal?: string;
  transfer_group_id?: string | null;
  transfer_direction?: string;
  credit_settlement_id?: string | null;
};
type CreditSettlement = {
  id: string;
  credit_account_id: string;
  payment_account_id: string;
  period_key: string;
  amount: number;
  settled_on: string;
};
const accountTypeLabel: Record<string, string> = {
  bank: "銀行",
  cash: "現金",
  wallet: "電子マネー",
  investment: "投資",
  credit: "クレジットカード",
  other: "その他",
};
const typeLabel = (type: string) => accountTypeLabel[type] || type;
const PAYMENT_MONTH_LABEL = ["当月", "翌月", "翌々月"] as const;
const dayLabel = (day: number) => (day >= 29 ? "末日" : `${day}日`);
const creditClosingLabel = (day: number) =>
  day >= 29 ? "毎月末日" : `毎月${day}日`;
const creditPaymentLabel = (offset: number | null | undefined, day: number) =>
  `${PAYMENT_MONTH_LABEL[offset ?? 1] ?? "翌月"}${dayLabel(day)}`;
const CATEGORY_PALETTE = [
  { value: "#00c4cc", label: "ターコイズ" },
  { value: "#ffcd00", label: "イエロー" },
  { value: "#ff9100", label: "オレンジ" },
  { value: "#e65537", label: "コーラル" },
  { value: "#2d4b9b", label: "ネイビー" },
  { value: "#2d7df0", label: "ブルー" },
  { value: "#69d7ff", label: "スカイ" },
  { value: "#4bb47d", label: "グリーン" },
  { value: "#05878c", label: "ティール" },
] as const;
const CATEGORY_COLORS = CATEGORY_PALETTE.map((color) => color.value);
const FALLBACK_CATEGORY_COLOR = "#aaa69f";
const categoryColor = (color: string | undefined, index: number) =>
  color || CATEGORY_COLORS[index % CATEGORY_COLORS.length] || FALLBACK_CATEGORY_COLOR;
const categoryColorLabel = (value: string | undefined) =>
  CATEGORY_PALETTE.find((color) => color.value.toLowerCase() === value?.toLowerCase())
    ?.label;
const nextCategoryColor = (categories: Category[]) => {
  const used = new Set(
    categories
      .map((category) => category.color?.toLowerCase())
      .filter((color): color is string => Boolean(color)),
  );
  return (
    CATEGORY_PALETTE.find((color) => !used.has(color.value.toLowerCase()))?.value ??
    CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]
  );
};
const donutGradient = (slices: { color: string; amount: number }[]) => {
  const total = slices.reduce((n, slice) => n + slice.amount, 0);
  if (total <= 0) return `conic-gradient(${FALLBACK_CATEGORY_COLOR} 0 100%)`;
  let start = 0;
  return `conic-gradient(${slices
    .map((slice, index) => {
      const end =
        index === slices.length - 1
          ? 100
          : Math.min(100, start + (slice.amount / total) * 100);
      const stop = `${slice.color} ${start}% ${end}%`;
      start = end;
      return stop;
    })
    .join(", ")})`;
};
type Recurring = {
  id: string;
  account_id: string;
  category_id?: string;
  type: "income" | "expense";
  amount: number;
  title: string;
  description?: string;
  journal_template?: string;
  frequency: "monthly" | "yearly";
  start_date?: string;
  end_date?: string;
  execution_day: number;
  next_execution_date: string;
  enabled: boolean;
};
type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  is_active: boolean;
  timezone: string;
  currency: string;
  created_at: string;
};
type McpConnection = {
  id: string;
  secret_prefix: string;
  last_used_at?: string;
  created_at: string;
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const apiFetch = (input: string, init: RequestInit = {}) =>
  fetch(input, { ...init, credentials: "include" });

const money = (value: number | string) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value));
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
const compactYen = (value: number) => {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 10000) return `${Math.round(rounded / 10000)}万`;
  return rounded.toLocaleString("ja-JP");
};
const formatPct = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
const toDateInput = (value: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(value),
  );
const monthWindow = (offset: number) => {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth() + offset, 1),
    end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 1),
  };
};
const inRange = (value: string, start: Date, end: Date) => {
  const at = new Date(value);
  return at >= start && at < end;
};
const signedImpact = (t: Transaction) =>
  t.type === "income" || t.transfer_direction === "credit"
    ? Number(t.amount)
    : t.type === "expense" || t.transfer_direction === "debit"
      ? -Number(t.amount)
      : 0;
const applyAccountImpact = (
  accounts: Account[],
  txs: Transaction[],
  sign: 1 | -1,
) => {
  const deltas = new Map<string, number>();
  for (const t of txs) {
    deltas.set(
      t.account_id,
      (deltas.get(t.account_id) || 0) + sign * signedImpact(t),
    );
  }
  return accounts.map((a) =>
    deltas.has(a.id)
      ? {
          ...a,
          current_balance: Number(a.current_balance) + (deltas.get(a.id) || 0),
        }
      : a,
  );
};
const relatedTransactions = (all: Transaction[], t: Transaction) =>
  t.transfer_group_id
    ? all.filter(
        (x) => x.id === t.id || x.transfer_group_id === t.transfer_group_id,
      )
    : [t];
async function fetchAccounts(): Promise<Account[]> {
  const response = await apiFetch(`${API}/accounts`);
  if (!response.ok) throw new Error("accounts");
  return response.json();
}
const assetsAt = (
  accounts: Account[],
  transactions: Transaction[],
  at: Date,
  accountId?: string,
) => {
  const current = accounts
    .filter((a) => !accountId || a.id === accountId)
    .reduce((n, a) => n + Number(a.current_balance), 0);
  return (
    current -
    transactions
      .filter(
        (t) =>
          new Date(t.occurred_at) > at &&
          (!accountId || t.account_id === accountId),
      )
      .reduce((n, t) => n + signedImpact(t), 0)
  );
};
const monthlySeries = (
  accounts: Account[],
  transactions: Transaction[],
  count: number,
  accountId?: string,
) => {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const monthsAgo = count - 1 - index;
    const at =
      monthsAgo === 0
        ? now
        : new Date(
            now.getFullYear(),
            now.getMonth() - monthsAgo + 1,
            0,
            23,
            59,
            59,
            999,
          );
    return {
      label: `${at.getMonth() + 1}月`,
      value: assetsAt(accounts, transactions, at, accountId),
    };
  });
};
const compareNote = (current: number, previous: number) => {
  if (current === 0 && previous === 0) return "先月・今月とも記録なし";
  if (previous === 0) return "先月は記録なし";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${current >= previous ? "↑" : "↓"} ${pct > 0 ? "+" : ""}${formatPct(pct)}% 先月比`;
};
const nav = [
  ["/dashboard", "⌂", "ホーム"],
  ["/transactions", "↕", "取引"],
  ["/accounts", "▣", "口座"],
  ["/recurring", "↻", "定期"],
  ["/analytics", "⌁", "分析"],
  ["/settings", "⚙", "設定"],
];

async function fetchAllTransactions(): Promise<Transaction[]> {
  const items: Transaction[] = [];
  let page = 1;
  let total = 0;
  do {
    const response = await apiFetch(
      `${API}/transactions?page=${page}&page_size=100`,
    );
    if (!response.ok) throw new Error("transactions");
    const payload = await response.json();
    items.push(...payload.items);
    total = payload.total;
    page += 1;
  } while (items.length < total);
  return items;
}

function useRoute() {
  const [path, setPath] = useState("/dashboard");
  useEffect(() => {
    const sync = () =>
      setPath(location.pathname === "/" ? "/dashboard" : location.pathname);
    sync();
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  const go = (next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    scrollTo({ top: 0, behavior: "smooth" });
  };
  return { path, go };
}

function AuthScreen({
  notice,
  authenticated,
}: {
  notice: string;
  authenticated: (user: User) => void;
}) {
  const initialMode =
    typeof location !== "undefined" && location.pathname === "/reset-password"
      ? "reset"
      : "login";
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(
    initialMode,
  );
  const [message, setMessage] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState(() =>
    typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("token") || ""
      : "",
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const fd = new FormData(event.currentTarget);
    try {
      if (mode === "forgot") {
        const response = await apiFetch(`${API}/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: fd.get("email") }),
        });
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (payload.debug_reset_token) {
          setResetToken(payload.debug_reset_token);
          setMode("reset");
          setMessage("開発環境用の再設定画面を開きました。");
        } else
          setMessage(
            "登録済みの場合、再設定メールを送信しました。メールをご確認ください。",
          );
        return;
      }
      if (mode === "reset") {
        const password = String(fd.get("password"));
        if (password !== fd.get("confirm_password"))
          throw new Error("パスワードが一致しません");
        const response = await apiFetch(`${API}/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: resetToken, new_password: password }),
        });
        if (!response.ok)
          throw new Error(
            "リンクの期限が切れているか、パスワードの条件を満たしていません",
          );
        history.replaceState({}, "", "/");
        setMode("login");
        setMessage(
          "パスワードを更新しました。新しいパスワードでログインしてください。",
        );
        return;
      }
      const endpoint = mode === "register" ? "register" : "login";
      const payload =
        mode === "register"
          ? {
              name: fd.get("name"),
              email: fd.get("email"),
              password: fd.get("password"),
            }
          : {
              email: fd.get("email"),
              password: fd.get("password"),
              remember_me: fd.get("remember_me") === "on",
            };
      const response = await apiFetch(`${API}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "入力内容を確認してください");
      }
      authenticated(await response.json());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "処理を完了できませんでした",
      );
    } finally {
      setBusy(false);
    }
  };
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setMessage("");
    history.replaceState({}, "", next === "reset" ? "/reset-password" : "/");
  };
  return (
    <div className="auth-shell">
      <section className="auth-intro">
        <div className="auth-brand">
          <span className="brand-mark">t</span>
          <span>tally</span>
        </div>
        <p className="eyebrow">DAILY TALLY</p>
        <h1>
          今日の残高を、
          <br />
          楽しみに開く。
        </h1>
        <p>
          家計、資産、その日の出来事をひとつに。数字を追うだけでなく、毎日の暮らしを数えながら見ていくための場所です。
        </p>
        <ul>
          <li>家計と資産を、同じ流れで記録する</li>
          <li>取引に、今日のひとことを添えられる</li>
          <li>残高の移り変わりを、毎日眺める</li>
        </ul>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">WELCOME</p>
          <h2>
            {mode === "register"
              ? "アカウントを作成"
              : mode === "forgot"
                ? "パスワードをお忘れですか？"
                : mode === "reset"
                  ? "新しいパスワードを設定"
                  : "ログイン"}
          </h2>
          <p className="auth-description">
            {mode === "register"
              ? "メールアドレスとパスワードでアカウントを作成します。パスワードは10文字以上で、英字と数字を含めてください。"
              : mode === "forgot"
                ? "登録したメールアドレスへ再設定リンクを送ります。"
                : mode === "reset"
                  ? "10文字以上で、英字と数字を含めてください。"
                  : "登録済みのメールアドレスとパスワードを入力してください。"}
          </p>
          {message && (
            <div className="auth-message" role="status">
              {message}
            </div>
          )}
          {mode === "register" && (
            <label>
              <span>お名前</span>
              <input name="name" autoComplete="name" required />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              <span>メールアドレス</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              <span>
                {mode === "reset" ? "新しいパスワード" : "パスワード"}
              </span>
              <input
                name="password"
                type="password"
                minLength={mode === "login" ? 1 : 10}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
            </label>
          )}
          {mode === "reset" && (
            <>
              <label>
                <span>パスワード（確認）</span>
                <input
                  name="confirm_password"
                  type="password"
                  minLength={10}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label>
                <span>再設定トークン</span>
                <input
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          {mode === "login" && (
            <label className="remember-row">
              <input type="checkbox" name="remember_me" defaultChecked />
              <span>この端末でログイン状態を保持する（30日間）</span>
            </label>
          )}
          <button className="primary auth-submit" disabled={busy}>
            {busy
              ? "処理中…"
              : mode === "register"
                ? "アカウントを作成"
                : mode === "forgot"
                  ? "再設定メールを送る"
                  : mode === "reset"
                    ? "パスワードを更新"
                    : "ログイン"}
          </button>
          <div className="auth-links">
            {mode === "login" && (
              <>
                <button type="button" onClick={() => changeMode("forgot")}>
                  パスワードを忘れた
                </button>
                <button type="button" onClick={() => changeMode("register")}>
                  新規アカウント作成
                </button>
              </>
            )}
            {mode !== "login" && (
              <button type="button" onClick={() => changeMode("login")}>
                ログインへ戻る
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

export function WalletApp() {
  const { path, go } = useRoute();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "anonymous" | "authenticated"
  >("loading");
  const [authNotice, setAuthNotice] = useState("");
  const [toast, setToast] = useState("");
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const loadFinanceData = async () => {
    const [a, c, t, r] = await Promise.all([
      apiFetch(`${API}/accounts`),
      apiFetch(`${API}/categories`),
      fetchAllTransactions(),
      apiFetch(`${API}/recurring-transactions`),
    ]);
    if (![a, c, r].every((x) => x.ok)) throw new Error();
    setAccounts(await a.json());
    setCategories(await c.json());
    setTransactions(t);
    setRecurring(await r.json());
    setConnected(true);
  };

  useEffect(() => {
    apiFetch(`${API}/auth/me`)
      .then(async (response) => {
        if (response.status === 401) {
          setAuthState("anonymous");
          return;
        }
        if (!response.ok) throw new Error();
        const current = await response.json();
        setUser(current);
        setAuthState("authenticated");
        await loadFinanceData();
      })
      .catch(() => {
        setConnected(false);
        setAuthNotice(
          "サーバーに接続できません。立ち上げ方法を確認してから再試行してください。",
        );
        setAuthState("anonymous");
      });
  }, []);

  if (authState === "loading")
    return (
      <div className="auth-shell">
        <div className="auth-card loading-card">
          <span className="brand-mark">t</span>
          <p>安全なセッションを確認しています…</p>
        </div>
      </div>
    );
  if (authState === "anonymous" || !user)
    return (
      <AuthScreen
        notice={authNotice}
        authenticated={(value) => {
          setUser(value);
          setAuthState("authenticated");
          setAuthNotice("");
          loadFinanceData().catch(() => setConnected(false));
          go("/dashboard");
        }}
      />
    );

  const logout = async () => {
    await apiFetch(`${API}/auth/logout`, { method: "POST" }).catch(
      () => undefined,
    );
    setUser(null);
    setAuthState("anonymous");
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setRecurring([]);
    setConnected(false);
    go("/");
  };

  const active =
    nav.find(([href]) => path.startsWith(href) && href !== "/dashboard") ||
    nav[0];
  const contentProps = {
    accounts,
    categories,
    transactions,
    recurring,
    connected,
    setTransactions,
    setAccounts,
    setRecurring,
    setCategories,
    go,
    notify,
  };
  let content = <Dashboard {...contentProps} />;
  if (path === "/transactions/new")
    content = <TransactionForm {...contentProps} />;
  else if (path.startsWith("/transactions"))
    content = <Transactions {...contentProps} />;
  else if (path.startsWith("/accounts/"))
    content = <AccountDetail {...contentProps} id={path.split("/")[2]} />;
  else if (path === "/accounts") content = <Accounts {...contentProps} />;
  else if (path === "/recurring") content = <RecurringPage {...contentProps} />;
  else if (path === "/analytics") content = <Analytics {...contentProps} />;
  else if (path === "/settings")
    content = (
      <Settings
        notify={notify}
        user={user}
        setUser={setUser}
        categories={categories}
        setCategories={setCategories}
        connected={connected}
      />
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("/dashboard")}>
          <span className="brand-mark">t</span>
          <span>tally</span>
        </button>
        <nav aria-label="メインナビゲーション">
          {nav.map(([href, icon, label]) => (
            <button
              key={href}
              className={
                path.startsWith(href) &&
                (href !== "/dashboard" || path === "/dashboard")
                  ? "active"
                  : ""
              }
              onClick={() => go(href)}
            >
              <span aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="profile-shortcut" onClick={() => go("/settings")}>
            <span className="avatar">{user.name[0]}</span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === "admin" ? "管理者" : "一般ユーザー"}</small>
            </span>
          </button>
          <button className="logout-button" onClick={logout}>
            ログアウト
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="mobile-header">
          <button className="brand" onClick={() => go("/dashboard")}>
            <span className="brand-mark">t</span>
            <span>tally</span>
          </button>
          <span>{active[2]}</span>
          <button
            className="mobile-profile"
            aria-label="設定を開く"
            onClick={() => go("/settings")}
          >
            {user.name[0]}
          </button>
        </header>
        {content}
      </main>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {nav.slice(0, 5).map(([href, icon, label]) => (
          <button
            key={href}
            className={
              path.startsWith(href) &&
              (href !== "/dashboard" || path === "/dashboard")
                ? "active"
                : ""
            }
            onClick={() => go(href)}
          >
            <span aria-hidden>{icon}</span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

type PageProps = {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurring: Recurring[];
  connected: boolean;
  setTransactions: (
    value: Transaction[] | ((current: Transaction[]) => Transaction[]),
  ) => void;
  setAccounts: (value: Account[] | ((current: Account[]) => Account[])) => void;
  setRecurring: (
    value: Recurring[] | ((current: Recurring[]) => Recurring[]),
  ) => void;
  setCategories: (
    value: Category[] | ((current: Category[]) => Category[]),
  ) => void;
  go: (path: string) => void;
  notify: (message: string) => void;
};

function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}

function Dashboard({ accounts, categories, transactions, go }: PageProps) {
  const thisMonth = monthWindow(0);
  const lastMonth = monthWindow(-1);
  const monthTx = transactions.filter((t) =>
    inRange(t.occurred_at, thisMonth.start, thisMonth.end),
  );
  const lastTx = transactions.filter((t) =>
    inRange(t.occurred_at, lastMonth.start, lastMonth.end),
  );
  const monthIncome = monthTx
    .filter((t) => t.type === "income")
    .reduce((n, t) => n + Number(t.amount), 0);
  const monthExpense = monthTx
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + Number(t.amount), 0);
  const lastIncome = lastTx
    .filter((t) => t.type === "income")
    .reduce((n, t) => n + Number(t.amount), 0);
  const lastExpense = lastTx
    .filter((t) => t.type === "expense")
    .reduce((n, t) => n + Number(t.amount), 0);
  const assets = accounts.reduce((n, a) => n + Number(a.current_balance), 0);
  const lastAssets = assetsAt(
    accounts,
    transactions,
    new Date(thisMonth.start.getTime() - 1),
  );
  const assetDeltaPct =
    lastAssets === 0
      ? null
      : ((assets - lastAssets) / Math.abs(lastAssets)) * 100;
  const savingsRate = monthIncome
    ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100)
    : null;
  const series = accounts.length
    ? monthlySeries(accounts, transactions, 7)
    : [];
  const sixMonthDelta = series.length
    ? series[series.length - 1].value - series[0].value
    : 0;
  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("ja-JP", { dateStyle: "full" }).format(
          new Date(),
        )}
        title="今日のお金を確認しましょう"
        action={
          <button className="primary" onClick={() => go("/transactions/new")}>
            ＋ 取引を追加
          </button>
        }
      />
      <section className="asset-hero">
        <div>
          <p>現在の総資産</p>
          <strong>{money(assets)}</strong>
          {accounts.length ? (
            assetDeltaPct === null ? (
              <span className="neutral">先月比の比較対象がありません</span>
            ) : (
              <span className={assetDeltaPct >= 0 ? "positive" : "negative"}>
                {assetDeltaPct >= 0 ? "↑" : "↓"} {assetDeltaPct > 0 ? "+" : ""}
                {formatPct(assetDeltaPct)}% <small>先月比</small>
              </span>
            )
          ) : (
            <span className="neutral">口座を追加すると表示されます</span>
          )}
        </div>
        {accounts.length ? (
          <MiniLine
            values={monthlySeries(accounts, transactions, 10).map(
              (p) => p.value,
            )}
          />
        ) : null}
      </section>
      <section className="metric-grid">
        <Metric
          label="今月の収入"
          value={money(monthIncome)}
          note={compareNote(monthIncome, lastIncome)}
          tone="income"
        />
        <Metric
          label="今月の支出"
          value={money(monthExpense)}
          note={compareNote(monthExpense, lastExpense)}
          tone="expense"
        />
        <Metric
          label="今月の収支"
          value={money(monthIncome - monthExpense)}
          note={
            savingsRate === null
              ? "収入がないため貯蓄率は算出できません"
              : `貯蓄率 ${savingsRate}%`
          }
          tone="balance"
        />
      </section>
      <div className="dashboard-grid">
        <section className="panel span-2">
          <SectionHead
            title="資産の推移"
            link="詳しく見る"
            onClick={() => go("/analytics")}
          />
          <div className="trend-summary">
            <strong>{money(assets)}</strong>
            {series.length ? (
              <span
                className={
                  sixMonthDelta > 0
                    ? "positive"
                    : sixMonthDelta < 0
                      ? "negative"
                      : "neutral"
                }
              >
                {sixMonthDelta === 0
                  ? "この期間の変化はありません"
                  : `${sixMonthDelta > 0 ? "＋" : "−"}${money(Math.abs(sixMonthDelta))}（6ヶ月）`}
              </span>
            ) : null}
          </div>
          <AssetChart
            series={series}
            empty="口座を追加すると推移が表示されます"
          />
        </section>
        <section className="panel accounts-panel">
          <SectionHead
            title="口座別残高"
            link="口座を管理"
            onClick={() => go("/accounts")}
          />
          <div className="account-list">
            {accounts.length ? (
              accounts.map((a, i) => (
                <button key={a.id} onClick={() => go(`/accounts/${a.id}`)}>
                  <span className={`account-icon icon-${i}`}>{a.name[0]}</span>
                  <span>
                    <strong>{a.name}</strong>
                    <small>
                      {a.institution_name || typeLabel(a.account_type)}
                    </small>
                  </span>
                  <b>{money(a.current_balance)}</b>
                </button>
              ))
            ) : (
              <p className="empty-inline">まだ口座がありません</p>
            )}
          </div>
        </section>
        <section className="panel span-2">
          <SectionHead
            title="最近の取引"
            link="すべて見る"
            onClick={() => go("/transactions")}
          />
          {transactions.length ? (
            <TransactionList
              items={transactions.slice(0, 5)}
              accounts={accounts}
              categories={categories}
              onClick={() => go("/transactions")}
            />
          ) : (
            <p className="empty-inline">まだ取引がありません</p>
          )}
        </section>
        <section className="panel journal-card">
          <p className="eyebrow">TODAY&apos;S NOTE</p>
          <h2>お金と一緒に、今日を残す</h2>
          <p>取引の記録には、その日の出来事や気持ちも書き残せます。</p>
          <button className="secondary" onClick={() => go("/transactions/new")}>
            今日の記録を書く →
          </button>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function SectionHead({
  title,
  link,
  onClick,
}: {
  title: string;
  link?: string;
  onClick?: () => void;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {link && <button onClick={onClick}>{link} →</button>}
    </div>
  );
}

function ColorSwatchPicker({
  name,
  value,
  defaultValue,
  onChange,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [internal, setInternal] = useState(
    value ?? defaultValue ?? CATEGORY_COLORS[0],
  );
  const selected = value ?? internal;
  const selectedLabel = categoryColorLabel(selected);
  const choose = (next: string) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };
  return (
    <fieldset className="color-swatches">
      <legend>
        色
        {selectedLabel ? <small> {selectedLabel}</small> : null}
      </legend>
      {name ? <input type="hidden" name={name} value={selected} /> : null}
      <div>
        {CATEGORY_PALETTE.map((color) => {
          const active = selected.toLowerCase() === color.value.toLowerCase();
          return (
            <button
              key={color.value}
              type="button"
              className={active ? "active" : undefined}
              style={{ background: color.value }}
              aria-label={color.label}
              aria-pressed={active}
              title={color.label}
              onClick={() => choose(color.value)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

function CategoryField({
  type,
  categories,
  setCategories,
  connected,
  notify,
  selectedId,
}: {
  type: "income" | "expense";
  categories: Category[];
  setCategories: (
    value: Category[] | ((current: Category[]) => Category[]),
  ) => void;
  connected: boolean;
  notify: (message: string) => void;
  selectedId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => nextCategoryColor(categories));
  const visible = categories.filter((c) => c.type === type);
  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      let item: Category = {
        id: crypto.randomUUID(),
        name: trimmed,
        type,
        color,
      };
      if (connected) {
        const response = await apiFetch(`${API}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, type, color }),
        });
        if (!response.ok) throw new Error();
        item = await response.json();
      }
      setCategories((all) => {
        const next = [...all, item];
        setColor(nextCategoryColor(next));
        return next;
      });
      setAdding(false);
      setName("");
      notify("カテゴリを追加しました");
    } catch {
      notify("同じ名前のカテゴリがあるか、追加できませんでした");
    }
  };
  return (
    <div className="category-field">
      <label>
        <span>
          カテゴリ{" "}
          <button
            type="button"
            className="inline-add"
            onClick={() => setAdding((open) => !open)}
          >
            ＋ 追加
          </button>
        </span>
        {visible.length ? (
          <select
            key={`${type}-${visible.map((c) => c.id).join("-")}`}
            required
            name="category_id"
            defaultValue={
              selectedId && visible.some((c) => c.id === selectedId)
                ? selectedId
                : visible[visible.length - 1]?.id
            }
          >
            {visible.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="form-help">先にカテゴリを追加してください</p>
        )}
      </label>
      {adding && (
        <div className="quick-category">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "income" ? "例：ボーナス" : "例：医療費"}
            maxLength={80}
          />
          <button
            type="button"
            className="secondary"
            onClick={add}
            disabled={!name.trim()}
          >
            追加
          </button>
          <ColorSwatchPicker value={color} onChange={setColor} />
        </div>
      )}
    </div>
  );
}

function MiniLine({ values }: { values: number[] }) {
  const max = Math.max(0, ...values);
  return (
    <div className="mini-bars" aria-label="直近の資産推移">
      {values.map((value, i) => (
        <i
          key={i}
          style={{
            height: `${max <= 0 ? 8 : Math.max(8, (value / max) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
function AssetChart({
  series,
  empty,
}: {
  series: { label: string; value: number }[];
  empty: string;
}) {
  if (!series.length) return <p className="empty-chart">{empty}</p>;
  const values = series.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 0);
  const pad = max === min ? Math.max(1000, Math.abs(max) * 0.1 || 1000) : 0;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const yOf = (value: number) => 170 - ((value - lo) / span) * 160;
  const xOf = (index: number) =>
    series.length === 1 ? 350 : (index / (series.length - 1)) * 700;
  const coords = series.map(
    (point, index) => `${xOf(index)},${yOf(point.value)}`,
  );
  const line = `M${coords.join(" L")}`;
  return (
    <div className="chart-wrap">
      <div className="chart-y">
        {[hi, hi - span / 3, lo + span / 3, lo].map((tick, i) => (
          <span key={i}>{compactYen(tick)}</span>
        ))}
      </div>
      <svg viewBox="0 0 700 180" role="img" aria-label="資産の推移">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#00c4cc" stopOpacity=".28" />
            <stop offset="1" stopColor="#00c4cc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="area"
          d={`${line} L${xOf(series.length - 1)},180 L0,180 Z`}
        />
        <path className="line" d={line} />
      </svg>
      <div className="chart-x">
        {series.map((point, index) => (
          <span key={`${point.label}-${index}`}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function TransactionList({
  items,
  accounts,
  categories,
  onClick,
}: {
  items: Transaction[];
  accounts: Account[];
  categories: Category[];
  onClick?: (t: Transaction) => void;
}) {
  return (
    <div className="transaction-list">
      {items.map((t) => {
        const category = categories.find((c) => c.id === t.category_id);
        return (
          <button key={t.id} onClick={() => onClick?.(t)}>
            <span className="date-cell">{shortDate(t.occurred_at)}</span>
            <span
              className="category-dot"
              style={{ background: category?.color || "#aaa69f" }}
            >
              {(category?.name || "振")[0]}
            </span>
            <span className="transaction-main">
              <strong>{t.title}</strong>
              <small>
                {category?.name || "口座振替"} ·{" "}
                {accounts.find((a) => a.id === t.account_id)?.name}
              </small>
            </span>
            <b className={t.type === "income" ? "amount-in" : ""}>
              {t.type === "income" ? "+" : "−"}
              {money(t.amount)}
            </b>
          </button>
        );
      })}
    </div>
  );
}

function Transactions({
  accounts,
  categories,
  transactions,
  setTransactions,
  setAccounts,
  setCategories,
  go,
  notify,
  connected,
}: PageProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [editing, setEditing] = useState(false);
  const filtered = transactions.filter(
    (t) =>
      (type === "all" || t.type === type) &&
      t.title.toLowerCase().includes(query.toLowerCase()),
  );
  const remove = async (t: Transaction) => {
    if (!confirm(`「${t.title}」を削除しますか？`)) return;
    const related = relatedTransactions(transactions, t);
    const removedIds = new Set(related.map((x) => x.id));
    try {
      if (connected) {
        const response = await apiFetch(`${API}/transactions/${t.id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error();
        setAccounts(await fetchAccounts());
        if (t.type === "transfer" || t.transfer_group_id) {
          setTransactions(await fetchAllTransactions());
        } else {
          setTransactions((all) => all.filter((x) => !removedIds.has(x.id)));
        }
      } else {
        setAccounts((all) => applyAccountImpact(all, related, -1));
        setTransactions((all) => all.filter((x) => !removedIds.has(x.id)));
      }
      setSelected(null);
      notify("取引を削除しました");
    } catch {
      notify("削除できませんでした");
    }
  };
  const closeDetail = () => {
    setEditing(false);
    setSelected(null);
  };
  const startEdit = (t: Transaction) => {
    if (t.type === "transfer") {
      notify("振替は削除して新しく作り直してください");
      return;
    }
    setEditing(true);
  };
  const applyEdit = async (previous: Transaction, updated: Transaction) => {
    if (connected) {
      setAccounts(await fetchAccounts());
    } else {
      setAccounts((all) =>
        applyAccountImpact(applyAccountImpact(all, [previous], -1), [updated], 1),
      );
    }
    setTransactions((all) =>
      all.map((x) => (x.id === updated.id ? updated : x)),
    );
    setSelected(updated);
    setEditing(false);
    notify("取引を更新しました");
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="MONEY & MOMENTS"
        title="取引"
        action={
          <button className="primary" onClick={() => go("/transactions/new")}>
            ＋ 取引を追加
          </button>
        }
      />
      <div className="filter-bar">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="取引を検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトルやメモを検索"
          />
        </label>
        <div className="segmented">
          <button
            className={type === "all" ? "active" : ""}
            onClick={() => setType("all")}
          >
            すべて
          </button>
          <button
            className={type === "expense" ? "active" : ""}
            onClick={() => setType("expense")}
          >
            支出
          </button>
          <button
            className={type === "income" ? "active" : ""}
            onClick={() => setType("income")}
          >
            収入
          </button>
        </div>
        <button className="secondary">日付・口座で絞る</button>
      </div>
      <section className="panel">
        <div className="table-caption">
          <span>{filtered.length}件の取引</span>
          <span>新しい順</span>
        </div>
        <TransactionList
          items={filtered}
          accounts={accounts}
          categories={categories}
          onClick={setSelected}
        />
      </section>
      {selected && (
        <div className="drawer-backdrop" onClick={closeDetail}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              aria-label="閉じる"
              onClick={closeDetail}
            >
              ×
            </button>
            {editing ? (
              <TransactionEditor
                item={selected}
                categories={categories}
                setCategories={setCategories}
                connected={connected}
                notify={notify}
                close={() => setEditing(false)}
                saved={(updated) => applyEdit(selected, updated)}
              />
            ) : (
              <>
            <p className="eyebrow">TRANSACTION DETAIL</p>
            <h2>{selected.title}</h2>
            <strong
              className={`detail-amount ${selected.type === "income" ? "amount-in" : ""}`}
            >
              {selected.type === "income" ? "+" : "−"}
              {money(selected.amount)}
            </strong>
            <dl>
              <div>
                <dt>日付</dt>
                <dd>{shortDate(selected.occurred_at)}</dd>
              </div>
              <div>
                <dt>カテゴリ</dt>
                <dd>
                  {categories.find((c) => c.id === selected.category_id)
                    ?.name || "振替"}
                </dd>
              </div>
              <div>
                <dt>口座</dt>
                <dd>
                  {accounts.find((a) => a.id === selected.account_id)?.name}
                </dd>
              </div>
            </dl>
            {selected.description && (
              <div className="detail-block">
                <small>説明</small>
                <p>{selected.description}</p>
              </div>
            )}
            {selected.journal && (
              <div className="journal-detail">
                <small>この日の記録</small>
                <p>{selected.journal}</p>
              </div>
            )}
            <div className="drawer-actions">
              <button
                className="secondary"
                onClick={() => startEdit(selected)}
              >
                編集
              </button>
              <button className="danger-link" onClick={() => remove(selected)}>
                削除
              </button>
            </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function TransactionEditor({
  item,
  categories,
  setCategories,
  connected,
  notify,
  close,
  saved,
}: {
  item: Transaction;
  categories: Category[];
  setCategories: PageProps["setCategories"];
  connected: boolean;
  notify: (message: string) => void;
  close: () => void;
  saved: (item: Transaction) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const kind = item.type === "income" ? "income" : "expense";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const fd = new FormData(event.currentTarget);
    const payload = {
      category_id: fd.get("category_id"),
      amount: fd.get("amount"),
      occurred_at: new Date(`${fd.get("date")}T12:00:00+09:00`).toISOString(),
      title: fd.get("title"),
      description: fd.get("description") || null,
      journal: fd.get("journal") || null,
    };
    try {
      let updated: Transaction = {
        ...item,
        ...payload,
        amount: Number(payload.amount),
      };
      if (connected) {
        const response = await apiFetch(`${API}/transactions/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await response.text());
        updated = await response.json();
      }
      await saved(updated);
    } catch {
      notify("保存できませんでした。入力内容を確認してください");
    } finally {
      setSaving(false);
    }
  };
  const visible = categories.filter((c) => c.type === kind);
  return (
    <>
      <p className="eyebrow">EDIT TRANSACTION</p>
      <h2>取引を編集</h2>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>タイトル</span>
          <input required name="title" defaultValue={item.title} maxLength={160} />
        </label>
        <div className="inline-fields">
          <label>
            <span>金額</span>
            <input
              required
              name="amount"
              type="number"
              min="1"
              step="1"
              defaultValue={item.amount}
            />
          </label>
          <label>
            <span>日付</span>
            <input
              required
              name="date"
              type="date"
              defaultValue={toDateInput(item.occurred_at)}
            />
          </label>
        </div>
        <CategoryField
          type={kind}
          categories={categories}
          setCategories={setCategories}
          connected={connected}
          notify={notify}
          selectedId={item.category_id}
        />
        <label>
          <span>
            説明 <small>任意</small>
          </span>
          <textarea
            name="description"
            rows={2}
            defaultValue={item.description || ""}
          />
        </label>
        <label>
          <span>
            この日の記録 <small>任意</small>
          </span>
          <textarea name="journal" rows={4} defaultValue={item.journal || ""} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            キャンセル
          </button>
          <button className="primary" disabled={saving || !visible.length}>
            {saving ? "保存中…" : "変更を保存"}
          </button>
        </div>
      </form>
    </>
  );
}

function TransactionForm({
  accounts,
  categories,
  setTransactions,
  setAccounts,
  setCategories,
  go,
  notify,
  connected,
}: PageProps) {
  const [kind, setKind] = useState<"expense" | "income" | "transfer">(
    "expense",
  );
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const fd = new FormData(event.currentTarget);
    const payload = {
      type: kind,
      amount: fd.get("amount"),
      occurred_at: new Date(`${fd.get("date")}T12:00:00+09:00`).toISOString(),
      account_id: fd.get("account_id"),
      destination_account_id:
        kind === "transfer" ? fd.get("destination_account_id") : null,
      category_id: kind === "transfer" ? null : fd.get("category_id"),
      title: fd.get("title"),
      description: fd.get("description"),
      journal: fd.get("journal"),
    };
    try {
      let tx: Transaction = {
        ...payload,
        id: crypto.randomUUID(),
        amount: Number(payload.amount),
      } as Transaction;
      if (connected) {
        const r = await apiFetch(`${API}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(await r.text());
        tx = await r.json();
        setAccounts(await fetchAccounts());
        if (kind === "transfer") {
          setTransactions(await fetchAllTransactions());
        } else {
          setTransactions((all) => [tx, ...all]);
        }
      } else {
        const amount = Number(payload.amount);
        const created: Transaction[] =
          kind === "transfer"
            ? [
                { ...tx, amount, transfer_direction: "debit" },
                {
                  ...tx,
                  id: crypto.randomUUID(),
                  account_id: String(payload.destination_account_id),
                  amount,
                  transfer_direction: "credit",
                },
              ]
            : [{ ...tx, amount }];
        setAccounts((all) => applyAccountImpact(all, created, 1));
        setTransactions((all) => [...created, ...all]);
      }
      notify("取引を保存しました");
      go("/transactions");
    } catch {
      notify("保存できませんでした。入力内容を確認してください");
    } finally {
      setSaving(false);
    }
  };
  const visibleCategories = categories.filter((c) => c.type === kind);
  return (
    <div className="page form-page">
      <button className="back-link" onClick={() => go("/transactions")}>
        ← 取引一覧へ
      </button>
      <PageHeader eyebrow="NEW TRANSACTION" title="取引を記録する" />
      <form className="transaction-form panel" onSubmit={submit}>
        <div className="type-switch">
          <button
            type="button"
            className={kind === "expense" ? "active" : ""}
            onClick={() => setKind("expense")}
          >
            支出
          </button>
          <button
            type="button"
            className={kind === "income" ? "active" : ""}
            onClick={() => setKind("income")}
          >
            収入
          </button>
          <button
            type="button"
            className={kind === "transfer" ? "active" : ""}
            onClick={() => setKind("transfer")}
          >
            振替
          </button>
        </div>
        <label className="amount-field">
          <span>金額</span>
          <div>
            <b>¥</b>
            <input
              required
              name="amount"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              placeholder="0"
            />
          </div>
        </label>
        <div className="form-grid">
          <label>
            <span>日付</span>
            <input
              required
              name="date"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            <span>口座</span>
            <select required name="account_id" defaultValue={accounts[0]?.id}>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {kind === "transfer" ? (
            <label>
              <span>振替先口座</span>
              <select
                required
                name="destination_account_id"
                defaultValue={accounts[1]?.id}
              >
                {accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <CategoryField
              type={kind}
              categories={categories}
              setCategories={setCategories}
              connected={connected}
              notify={notify}
            />
          )}
          <label className="full">
            <span>タイトル</span>
            <input
              required
              name="title"
              maxLength={160}
              placeholder={kind === "income" ? "例：給与" : "例：友人と夕食"}
            />
          </label>
          <label className="full">
            <span>
              説明 <small>任意</small>
            </span>
            <textarea
              name="description"
              rows={2}
              placeholder="場所や用途など、短いメモ"
            />
          </label>
        </div>
        <div className="journal-input">
          <div>
            <span className="journal-icon">✎</span>
            <div>
              <strong>この日のことを残す</strong>
              <p>この取引にまつわる出来事や、感じたことを書いてみましょう。</p>
            </div>
          </div>
          <textarea
            name="journal"
            rows={6}
            placeholder="今日は仕事帰りに友人と夕食。久しぶりに会えて楽しかった…"
          />
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => go("/transactions")}
          >
            キャンセル
          </button>
          <button
            className="primary"
            disabled={
              saving || (kind !== "transfer" && !visibleCategories.length)
            }
          >
            {saving ? "保存中…" : "記録を保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreditAutoPayFields({
  accounts,
  defaults,
  required,
}: {
  accounts: Account[];
  defaults?: Account;
  required?: boolean;
}) {
  const paymentCandidates = accounts.filter(
    (a) => a.account_type !== "credit" && a.id !== defaults?.id,
  );
  return (
    <>
      <p className="form-help">
        締日までの利用分を、指定した支払月の支払日に引き落とし元口座から自動で精算します。月末締めの場合は締日に31を指定してください。
      </p>
      <div className="inline-fields">
        <label>
          <span>締日</span>
          <input
            name="credit_closing_day"
            type="number"
            min="1"
            max="31"
            defaultValue={defaults?.credit_closing_day || 31}
            required={required}
          />
        </label>
        <label>
          <span>支払月</span>
          <select
            name="credit_payment_month_offset"
            defaultValue={defaults?.credit_payment_month_offset ?? 1}
          >
            <option value={0}>当月</option>
            <option value={1}>翌月</option>
            <option value={2}>翌々月</option>
          </select>
        </label>
      </div>
      <div className="inline-fields">
        <label>
          <span>支払日</span>
          <input
            name="credit_payment_day"
            type="number"
            min="1"
            max="31"
            defaultValue={defaults?.credit_payment_day || 27}
            required={required}
          />
        </label>
        <label>
          <span>引き落とし元口座</span>
          <select
            name="credit_payment_account_id"
            required={required}
            defaultValue={
              defaults?.credit_payment_account_id ||
              paymentCandidates[0]?.id ||
              ""
            }
          >
            {!required && (
              <option value="">未設定（自動引き落としを行わない）</option>
            )}
            {paymentCandidates.length ? (
              paymentCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            ) : (
              <option value="">
                先に引き落とし元の口座を作成してください
              </option>
            )}
          </select>
        </label>
      </div>
    </>
  );
}

function Accounts({ accounts, setAccounts, go, notify, connected }: PageProps) {
  const [open, setOpen] = useState(false);
  const [accountType, setAccountType] = useState("bank");
  const paymentCandidates = accounts.filter((a) => a.account_type !== "credit");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const isCredit = accountType === "credit";
    const payload = {
      name: fd.get("name"),
      account_type: accountType,
      institution_name: fd.get("institution_name") || null,
      initial_balance: fd.get("initial_balance"),
      credit_closing_day: isCredit
        ? Number(fd.get("credit_closing_day"))
        : null,
      credit_payment_day: isCredit
        ? Number(fd.get("credit_payment_day"))
        : null,
      credit_payment_month_offset: isCredit
        ? Number(fd.get("credit_payment_month_offset"))
        : null,
      credit_payment_account_id: isCredit
        ? fd.get("credit_payment_account_id")
        : null,
    };
    let item: Account = {
      id: crypto.randomUUID(),
      name: String(payload.name),
      account_type: accountType,
      current_balance: Number(payload.initial_balance),
      currency: "JPY",
      institution_name: String(payload.institution_name || ""),
      credit_closing_day: payload.credit_closing_day,
      credit_payment_day: payload.credit_payment_day,
      credit_payment_month_offset: payload.credit_payment_month_offset,
      credit_payment_account_id: payload.credit_payment_account_id as
        string | null,
    };
    try {
      if (connected) {
        const r = await apiFetch(`${API}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(await r.text());
        item = await r.json();
      }
      setAccounts((all) => [...all, item]);
      setOpen(false);
      setAccountType("bank");
      notify("口座を追加しました");
    } catch {
      notify("口座を追加できませんでした。入力内容を確認してください");
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="MY ASSETS"
        title="口座"
        action={
          <button className="primary" onClick={() => setOpen(true)}>
            ＋ 口座を追加
          </button>
        }
      />
      <div className="account-summary">
        <span>総資産</span>
        <strong>
          {money(accounts.reduce((n, a) => n + Number(a.current_balance), 0))}
        </strong>
        <small>{accounts.length}口座</small>
      </div>
      <div className="account-cards">
        {accounts.map((a, i) => (
          <button
            key={a.id}
            className="account-card panel"
            onClick={() => go(`/accounts/${a.id}`)}
          >
            <span className={`account-icon large icon-${i}`}>{a.name[0]}</span>
            <span>
              <small>{a.institution_name || typeLabel(a.account_type)}</small>
              <h2>{a.name}</h2>
            </span>
            <strong>{money(a.current_balance)}</strong>
            <em>詳細を見る →</em>
          </button>
        ))}
      </div>
      {open && (
        <Modal title="口座を追加" close={() => setOpen(false)}>
          <form onSubmit={submit} className="modal-form">
            <label>
              <span>口座名</span>
              <input required name="name" placeholder="例：生活口座" />
            </label>
            <label>
              <span>金融機関名</span>
              <input name="institution_name" placeholder="例：みらい銀行" />
            </label>
            <label>
              <span>口座タイプ</span>
              <select
                name="account_type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
              >
                <option value="bank">銀行</option>
                <option value="cash">現金</option>
                <option value="wallet">電子マネー</option>
                <option value="investment">投資</option>
                <option value="credit">クレジットカード</option>
                <option value="other">その他</option>
              </select>
            </label>
            <label>
              <span>初期残高</span>
              <input
                required
                name="initial_balance"
                type="number"
                min="0"
                defaultValue="0"
              />
            </label>
            {accountType === "credit" && (
              <CreditAutoPayFields accounts={accounts} required />
            )}
            <button
              className="primary"
              disabled={accountType === "credit" && !paymentCandidates.length}
            >
              追加する
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function AccountDetail({
  id,
  accounts,
  categories,
  transactions,
  setAccounts,
  go,
  notify,
  connected,
}: PageProps & { id: string }) {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState("bank");
  const [settlements, setSettlements] = useState<CreditSettlement[]>([]);
  const account = accounts.find((a) => a.id === id);
  useEffect(() => {
    const request =
      account && account.account_type === "credit" && connected
        ? apiFetch(`${API}/accounts/${account.id}/credit-settlements`).then(
            (r) => (r.ok ? r.json() : []),
          )
        : Promise.resolve([]);
    request.then(setSettlements).catch(() => setSettlements([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, account?.account_type, connected]);
  if (!account)
    return (
      <div className="page empty">
        <h1>口座が見つかりません</h1>
        <button onClick={() => go("/accounts")}>口座一覧へ</button>
      </div>
    );
  const items = transactions.filter((t) => t.account_id === id);
  const series = monthlySeries(accounts, transactions, 7, id);
  const sixMonthDelta = series.length
    ? series[series.length - 1].value - series[0].value
    : 0;
  const paymentAccount = accounts.find(
    (a) => a.id === account.credit_payment_account_id,
  );
  const unsettled = items
    .filter(
      (t) =>
        (t.type === "expense" || t.type === "income") &&
        !t.credit_settlement_id,
    )
    .reduce(
      (n, t) =>
        n + (t.type === "expense" ? Number(t.amount) : -Number(t.amount)),
      0,
    );
  const openEdit = () => {
    setEditType(account.account_type);
    setEditing(true);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const autoPayEnabled =
      editType === "credit" && !!fd.get("credit_payment_account_id");
    const payload = {
      name: fd.get("name"),
      account_type: editType,
      institution_name: fd.get("institution_name") || null,
      description: fd.get("description") || null,
      credit_closing_day: autoPayEnabled
        ? Number(fd.get("credit_closing_day"))
        : null,
      credit_payment_day: autoPayEnabled
        ? Number(fd.get("credit_payment_day"))
        : null,
      credit_payment_month_offset: autoPayEnabled
        ? Number(fd.get("credit_payment_month_offset"))
        : null,
      credit_payment_account_id: autoPayEnabled
        ? fd.get("credit_payment_account_id")
        : null,
    };
    try {
      let updated = { ...account, ...payload } as Account;
      if (connected) {
        const response = await apiFetch(`${API}/accounts/${account.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error();
        updated = await response.json();
      }
      setAccounts((all) =>
        all.map((item) => (item.id === account.id ? updated : item)),
      );
      setEditing(false);
      notify("口座情報を更新しました");
    } catch {
      notify("口座情報を更新できませんでした。入力内容を確認してください");
    }
  };
  const remove = async () => {
    if (!confirm(`「${account.name}」を削除しますか？取引履歴は残ります。`))
      return;
    try {
      if (connected) {
        const response = await apiFetch(`${API}/accounts/${account.id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error();
      }
      setAccounts((all) => all.filter((item) => item.id !== account.id));
      notify("口座を削除しました");
      go("/accounts");
    } catch {
      notify("口座を削除できませんでした");
    }
  };
  return (
    <div className="page">
      <button className="back-link" onClick={() => go("/accounts")}>
        ← 口座一覧へ
      </button>
      <PageHeader
        eyebrow={account.institution_name || typeLabel(account.account_type)}
        title={account.name}
        action={
          <div className="header-actions">
            <button className="secondary" onClick={openEdit}>
              口座を編集
            </button>
            <button className="danger-link" onClick={remove}>
              削除
            </button>
          </div>
        }
      />
      <section className="account-detail-hero">
        <span>現在残高</span>
        <strong>{money(account.current_balance)}</strong>
        <small>取引履歴から自動計算</small>
      </section>
      {account.account_type === "credit" && (
        <section className="info-banner">
          <span>💳</span>
          <p>
            {account.credit_closing_day &&
            account.credit_payment_day &&
            paymentAccount ? (
              <>
                <strong>
                  {creditClosingLabel(account.credit_closing_day)}締め →{" "}
                  {creditPaymentLabel(
                    account.credit_payment_month_offset,
                    account.credit_payment_day,
                  )}
                  に「{paymentAccount.name}」から自動引き落とし
                </strong>
                <br />
                未精算の利用額：{money(Math.max(0, unsettled))}
                {unsettled < 0 && "（次回の請求から差し引かれます）"}
              </>
            ) : (
              <>
                <strong>自動引き落としが未設定です</strong>
                <br />
                「口座を編集」から締日・支払日と引き落とし元口座を設定すると、毎月自動で精算されます。取引の入力が遅れても、次回の引き落としで自動的にまとめて精算されます。
              </>
            )}
          </p>
        </section>
      )}
      <div className="account-detail-grid">
        <section className="panel span-2">
          <SectionHead title="残高の推移" />
          <div className="trend-summary">
            <strong>{money(account.current_balance)}</strong>
            <span
              className={
                sixMonthDelta > 0
                  ? "positive"
                  : sixMonthDelta < 0
                    ? "negative"
                    : "neutral"
              }
            >
              {sixMonthDelta === 0
                ? "この期間の変化はありません"
                : `${sixMonthDelta > 0 ? "＋" : "−"}${money(Math.abs(sixMonthDelta))}（6ヶ月）`}
            </span>
          </div>
          <AssetChart
            series={series}
            empty="取引を追加すると推移が表示されます"
          />
        </section>
        {account.account_type === "credit" && (
          <section className="panel">
            <SectionHead title="自動引き落とし履歴" />
            <div className="token-list">
              {settlements.length ? (
                settlements.map((s) => (
                  <div key={s.id}>
                    <span>
                      <strong>{s.period_key}締め分の引き落とし</strong>
                      <small>{s.settled_on.replaceAll("-", "/")}</small>
                    </span>
                    <b>{money(s.amount)}</b>
                  </div>
                ))
              ) : (
                <p className="muted-text">
                  まだ引き落としの実行履歴はありません
                </p>
              )}
            </div>
          </section>
        )}
        <section className="panel span-2">
          <SectionHead title="この口座の取引" />
          <TransactionList
            items={items}
            accounts={accounts}
            categories={categories}
          />
        </section>
      </div>
      {editing && (
        <Modal title="口座を編集" close={() => setEditing(false)}>
          <form className="modal-form" onSubmit={save}>
            <label>
              <span>口座名</span>
              <input required name="name" defaultValue={account.name} />
            </label>
            <label>
              <span>金融機関名</span>
              <input
                name="institution_name"
                defaultValue={account.institution_name || ""}
              />
            </label>
            <label>
              <span>口座タイプ</span>
              <select
                name="account_type"
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
              >
                <option value="bank">銀行</option>
                <option value="cash">現金</option>
                <option value="wallet">電子マネー</option>
                <option value="investment">投資</option>
                <option value="credit">クレジットカード</option>
                <option value="other">その他</option>
              </select>
            </label>
            {editType === "credit" && (
              <CreditAutoPayFields accounts={accounts} defaults={account} />
            )}
            <label>
              <span>説明</span>
              <textarea
                name="description"
                rows={3}
                defaultValue={account.description || ""}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(false)}
              >
                キャンセル
              </button>
              <button className="primary">変更を保存</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function RecurringPage({
  recurring,
  accounts,
  categories,
  setRecurring,
  setCategories,
  notify,
  connected,
}: PageProps) {
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const toggle = async (item: Recurring) => {
    const enabled = !item.enabled;
    try {
      if (connected) {
        const response = await apiFetch(
          `${API}/recurring-transactions/${item.id}/${enabled ? "enable" : "disable"}`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error();
      }
      setRecurring((all) =>
        all.map((x) => (x.id === item.id ? { ...x, enabled } : x)),
      );
      notify(enabled ? "定期取引を再開しました" : "定期取引を停止しました");
    } catch {
      notify("状態を変更できませんでした");
    }
  };
  const remove = async (item: Recurring) => {
    setMenu(null);
    if (!confirm(`「${item.title}」の定期取引を削除しますか？`)) return;
    try {
      if (connected) {
        const response = await apiFetch(
          `${API}/recurring-transactions/${item.id}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error();
      }
      setRecurring((all) => all.filter((x) => x.id !== item.id));
      notify("定期取引を削除しました");
    } catch {
      notify("定期取引を削除できませんでした");
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="AUTOMATION"
        title="固定費・定期収入"
        action={
          <button
            className="primary"
            onClick={() => {
              if (!accounts.length) {
                notify("先に口座を追加してください");
                return;
              }
              setEditing("new");
            }}
          >
            ＋ 定期取引を追加
          </button>
        }
      />
      <div className="info-banner">
        <span>↻</span>
        <p>
          <strong>毎月の記録を自動化</strong>
          　設定した日に取引が自動で作成されます。二重登録はされません。
        </p>
      </div>
      <section className="panel recurring-list">
        <div className="table-caption">
          <span>{recurring.length}件の定期取引</span>
          <span>次回実行日順</span>
        </div>
        {recurring.map((r) => (
          <article key={r.id} className={!r.enabled ? "disabled" : ""}>
            <span className="recurring-icon">
              {r.type === "income" ? "+" : "↻"}
            </span>
            <div>
              <h2>{r.title}</h2>
              <p>
                {categories.find((c) => c.id === r.category_id)?.name} ·{" "}
                {accounts.find((a) => a.id === r.account_id)?.name}
              </p>
            </div>
            <strong className={r.type === "income" ? "amount-in" : ""}>
              {r.type === "income" ? "+" : "−"}
              {money(r.amount)}
            </strong>
            <div className="schedule">
              <b>
                {r.frequency === "yearly" ? "毎年" : "毎月"} {r.execution_day}日
              </b>
              <small>次回 {r.next_execution_date.replaceAll("-", "/")}</small>
            </div>
            <label className="switch">
              <input
                aria-label={`${r.title}を${r.enabled ? "停止" : "再開"}`}
                type="checkbox"
                checked={r.enabled}
                onChange={() => toggle(r)}
              />
              <span />
            </label>
            <div className="recurring-actions">
              <button
                className="more"
                aria-expanded={menu === r.id}
                aria-label={`${r.title}のメニュー`}
                onClick={() => setMenu(menu === r.id ? null : r.id)}
              >
                •••
              </button>
              {menu === r.id && (
                <div className="action-menu">
                  <button
                    onClick={() => {
                      setEditing(r);
                      setMenu(null);
                    }}
                  >
                    編集
                  </button>
                  <button className="danger-menu" onClick={() => remove(r)}>
                    削除
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
      {editing && (
        <RecurringEditor
          item={editing === "new" ? undefined : editing}
          accounts={accounts}
          categories={categories}
          setCategories={setCategories}
          connected={connected}
          notify={notify}
          close={() => setEditing(null)}
          saved={(item) => {
            setRecurring((all) =>
              editing === "new"
                ? [...all, item]
                : all.map((x) => (x.id === item.id ? item : x)),
            );
            setEditing(null);
            notify(
              editing === "new"
                ? "定期取引を追加しました"
                : "定期取引を更新しました",
            );
          }}
        />
      )}
    </div>
  );
}

function Analytics({ transactions, categories }: PageProps) {
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">(
    "monthly",
  );
  const relevant = useMemo(
    () => transactions.filter((t) => t.type !== "transfer"),
    [transactions],
  );
  const totals = useMemo(
    () =>
      relevant.reduce(
        (sum, t) => ({
          ...sum,
          [t.type]: sum[t.type as "income" | "expense"] + Number(t.amount),
        }),
        { income: 0, expense: 0 },
      ),
    [relevant],
  );
  const rows = useMemo(() => {
    const grouped = new Map<
      string,
      { label: string; income: number; expense: number }
    >();
    relevant.forEach((t) => {
      const d = new Date(t.occurred_at);
      const key =
        period === "daily"
          ? d.toISOString().slice(0, 10)
          : period === "monthly"
            ? d.toISOString().slice(0, 7)
            : String(d.getFullYear());
      const label =
        period === "daily"
          ? `${d.getMonth() + 1}/${d.getDate()}`
          : period === "monthly"
            ? `${d.getFullYear()}年${d.getMonth() + 1}月`
            : `${d.getFullYear()}年`;
      const row = grouped.get(key) || { label, income: 0, expense: 0 };
      row[t.type as "income" | "expense"] += Number(t.amount);
      grouped.set(key, row);
    });
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        key,
        ...value,
        net: value.income - value.expense,
      }));
  }, [relevant, period]);
  const maxValue = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
  const visibleRows = period === "daily" ? rows.slice(-14) : rows;
  const categoryTotals = useMemo(() => {
    const expenses = relevant.filter((t) => t.type === "expense");
    const rows = categories
      .filter((c) => c.type === "expense")
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        amount: expenses
          .filter((t) => t.category_id === c.id)
          .reduce((n, t) => n + Number(t.amount), 0),
      }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map((c, index) => ({ ...c, color: categoryColor(c.color, index) }));
    const uncategorized = expenses
      .filter((t) => !t.category_id)
      .reduce((n, t) => n + Number(t.amount), 0);
    if (uncategorized > 0) {
      rows.push({
        id: "uncategorized",
        name: "未分類",
        color: FALLBACK_CATEGORY_COLOR,
        amount: uncategorized,
      });
    }
    return rows;
  }, [categories, relevant]);
  const categorySpendTotal = categoryTotals.reduce((n, c) => n + c.amount, 0);
  const savingsRate = totals.income
    ? Math.round(((totals.income - totals.expense) / totals.income) * 100)
    : 0;
  return (
    <div className="page">
      <PageHeader eyebrow="INSIGHTS" title="収支分析" />
      <div className="analysis-controls">
        <div className="segmented">
          <button
            className={period === "daily" ? "active" : ""}
            onClick={() => setPeriod("daily")}
          >
            日次
          </button>
          <button
            className={period === "monthly" ? "active" : ""}
            onClick={() => setPeriod("monthly")}
          >
            月次
          </button>
          <button
            className={period === "yearly" ? "active" : ""}
            onClick={() => setPeriod("yearly")}
          >
            年次
          </button>
        </div>
        <span className="data-note">
          登録済み取引 {relevant.length}件を集計
        </span>
      </div>
      <section className="metric-grid">
        <Metric
          label="収入"
          value={money(totals.income)}
          note={`${relevant.filter((t) => t.type === "income").length}件の収入`}
          tone="income"
        />
        <Metric
          label="支出"
          value={money(totals.expense)}
          note={`${relevant.filter((t) => t.type === "expense").length}件の支出`}
          tone="expense"
        />
        <Metric
          label="純収支"
          value={money(totals.income - totals.expense)}
          note={`貯蓄率 ${savingsRate}%`}
          tone="balance"
        />
      </section>
      <div className="analytics-grid">
        <section className="panel span-2">
          <SectionHead title="収入と支出" />
          {visibleRows.length ? (
            <>
              <div className="bar-chart">
                {visibleRows.map((r) => (
                  <div key={r.key}>
                    <span>
                      <i
                        className="income-bar"
                        title={`収入 ${money(r.income)}`}
                        style={{
                          height: `${Math.max(r.income ? 3 : 0, (r.income / maxValue) * 100)}%`,
                        }}
                      />
                      <i
                        className="expense-bar"
                        title={`支出 ${money(r.expense)}`}
                        style={{
                          height: `${Math.max(r.expense ? 3 : 0, (r.expense / maxValue) * 100)}%`,
                        }}
                      />
                    </span>
                    <small>{r.label.replace(/^\d{4}年/, "")}</small>
                  </div>
                ))}
              </div>
              <div className="legend">
                <span>
                  <i className="income-color" />
                  収入
                </span>
                <span>
                  <i className="expense-color" />
                  支出
                </span>
              </div>
              <div className="analysis-table-wrap">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>期間</th>
                      <th>収入</th>
                      <th>支出</th>
                      <th>純収支</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].reverse().map((r) => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="amount-in">{money(r.income)}</td>
                        <td>{money(r.expense)}</td>
                        <td className={r.net >= 0 ? "amount-in" : ""}>
                          {money(r.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="empty-chart">集計できる取引がありません。</p>
          )}
        </section>
        <section className="panel category-analysis">
          <SectionHead title="カテゴリ別支出" />
          {categoryTotals.length ? (
            <>
              <div
                className="donut"
                aria-label="カテゴリ別支出の円グラフ"
                style={{ background: donutGradient(categoryTotals) }}
              >
                <strong>
                  合計
                  <em>{money(categorySpendTotal)}</em>
                </strong>
              </div>
              {categoryTotals.map((c) => (
                <div className="category-row" key={c.id}>
                  <i style={{ background: c.color }} />
                  <span>{c.name}</span>
                  <strong>{money(c.amount)}</strong>
                </div>
              ))}
            </>
          ) : (
            <p className="empty-chart">支出カテゴリの集計がありません。</p>
          )}
        </section>
      </div>
    </div>
  );
}

function RecurringEditor({
  item,
  accounts,
  categories,
  setCategories,
  connected,
  notify,
  close,
  saved,
}: {
  item?: Recurring;
  accounts: Account[];
  categories: Category[];
  setCategories: PageProps["setCategories"];
  connected: boolean;
  notify: (message: string) => void;
  close: () => void;
  saved: (item: Recurring) => void;
}) {
  const [kind, setKind] = useState<"income" | "expense">(
    item?.type || "expense",
  );
  const [saving, setSaving] = useState(false);
  const start = item?.start_date || new Date().toISOString().slice(0, 10);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const fd = new FormData(event.currentTarget);
    const payload = {
      account_id: fd.get("account_id"),
      category_id: fd.get("category_id"),
      type: kind,
      amount: fd.get("amount"),
      title: fd.get("title"),
      description: fd.get("description") || null,
      journal_template: fd.get("journal_template") || null,
      frequency: fd.get("frequency"),
      start_date: fd.get("start_date"),
      end_date: fd.get("end_date") || null,
      execution_day: Number(fd.get("execution_day")),
      enabled: item?.enabled ?? true,
    };
    try {
      let result: Recurring = {
        id: item?.id || crypto.randomUUID(),
        next_execution_date: start,
        ...payload,
        amount: Number(payload.amount),
      } as Recurring;
      if (connected) {
        const response = await apiFetch(
          `${API}/recurring-transactions${item ? `/${item.id}` : ""}`,
          {
            method: item ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) throw new Error(await response.text());
        result = await response.json();
      }
      saved(result);
    } catch {
      alert(
        "入力内容を確認してください。口座とカテゴリの種類が一致している必要があります。",
      );
    } finally {
      setSaving(false);
    }
  };
  const filtered = categories.filter((c) => c.type === kind);
  return (
    <Modal title={item ? "定期取引を編集" : "定期取引を追加"} close={close}>
      <form className="modal-form recurring-form" onSubmit={submit}>
        <div className="type-switch">
          <button
            type="button"
            className={kind === "expense" ? "active" : ""}
            onClick={() => setKind("expense")}
          >
            支出
          </button>
          <button
            type="button"
            className={kind === "income" ? "active" : ""}
            onClick={() => setKind("income")}
          >
            収入
          </button>
        </div>
        <label>
          <span>タイトル</span>
          <input
            required
            name="title"
            defaultValue={item?.title || ""}
            placeholder="例：家賃"
          />
        </label>
        <div className="inline-fields">
          <label>
            <span>金額</span>
            <input
              required
              name="amount"
              type="number"
              min="1"
              defaultValue={item?.amount || ""}
            />
          </label>
          <label>
            <span>実行日</span>
            <input
              required
              name="execution_day"
              type="number"
              min="1"
              max="31"
              defaultValue={item?.execution_day || 25}
            />
          </label>
        </div>
        <div className="inline-fields">
          <label>
            <span>口座</span>
            <select
              name="account_id"
              defaultValue={item?.account_id || accounts[0]?.id}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <CategoryField
            type={kind}
            categories={categories}
            setCategories={setCategories}
            connected={connected}
            notify={notify}
            selectedId={item?.category_id}
          />
        </div>
        <div className="inline-fields">
          <label>
            <span>頻度</span>
            <select
              name="frequency"
              defaultValue={item?.frequency || "monthly"}
            >
              <option value="monthly">毎月</option>
              <option value="yearly">毎年</option>
            </select>
          </label>
          <label>
            <span>開始日</span>
            <input
              required
              name="start_date"
              type="date"
              defaultValue={start}
            />
          </label>
        </div>
        <label>
          <span>
            終了日 <small>任意</small>
          </span>
          <input
            name="end_date"
            type="date"
            defaultValue={item?.end_date || ""}
          />
        </label>
        <label>
          <span>説明</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={item?.description || ""}
          />
        </label>
        <label>
          <span>日記テンプレート</span>
          <textarea
            name="journal_template"
            rows={3}
            defaultValue={item?.journal_template || ""}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            キャンセル
          </button>
          <button className="primary" disabled={saving || !filtered.length}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Settings({
  notify,
  user,
  setUser,
  categories,
  setCategories,
  connected,
}: {
  notify: (message: string) => void;
  user: User;
  setUser: (user: User) => void;
  categories: Category[];
  setCategories: PageProps["setCategories"];
  connected: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [editing, setEditing] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<Category | "new" | null>(
    null,
  );
  const [mcpConnection, setMcpConnection] = useState<McpConnection | null>(null);
  const [revealedMcpUrl, setRevealedMcpUrl] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    apiFetch(`${API}/auth/mcp-connection`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setMcpConnection);
    if (user.role === "admin")
      apiFetch(`${API}/admin/users`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setUsers);
  }, [user.role]);
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      const response = await apiFetch(`${API}/auth/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          timezone: fd.get("timezone"),
          currency: fd.get("currency"),
        }),
      });
      if (!response.ok) throw new Error();
      setUser(await response.json());
      setEditing(false);
      notify("プロフィールを更新しました");
    } catch {
      notify("プロフィールを更新できませんでした");
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    if (fd.get("new_password") !== fd.get("confirm_password")) {
      notify("新しいパスワードが一致しません");
      return;
    }
    const response = await apiFetch(`${API}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: fd.get("current_password"),
        new_password: fd.get("new_password"),
      }),
    });
    if (response.ok) {
      setPasswordOpen(false);
      notify("パスワードを変更しました");
    } else notify("現在のパスワードまたは入力条件を確認してください");
  };
  const backup = async () => {
    try {
      const r = await apiFetch(`${API}/backup`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `tally-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      notify("バックアップを書き出しました");
    } catch {
      notify("バックアップに失敗しました");
    }
  };
  const restore = async (file?: File) => {
    if (!file) return;
    if (!confirm("現在のデータをバックアップ内容で置き換えます。続けますか？"))
      return;
    setRestoring(true);
    try {
      const payload = JSON.parse(await file.text());
      if (payload.schema_version !== 1 || !payload.data) throw new Error();
      const r = await apiFetch(`${API}/backup/restore?confirm=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error();
      notify("バックアップを復元しました。画面を更新します");
      setTimeout(() => location.reload(), 800);
    } catch {
      notify("このバックアップは復元できませんでした");
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const deleteAll = async () => {
    if (
      !confirm(
        "すべての口座・カテゴリ・取引・定期取引を完全に削除します。元に戻せません。続けますか？",
      )
    )
      return;
    const response = await apiFetch(`${API}/admin/data?confirm=true`, {
      method: "DELETE",
    });
    if (response.ok) {
      notify("すべての家計データを削除しました");
      setTimeout(() => location.reload(), 700);
    } else notify("データを削除できませんでした");
  };
  const issueMcpUrl = async () => {
    if (mcpConnection && !confirm("新しい接続URLを発行すると、現在のURLはすぐに使えなくなります。続けますか？")) return;
    const response = await apiFetch(`${API}/auth/mcp-connection`, {
      method: "POST",
    });
    if (!response.ok) {
      notify("MCP接続URLを発行できませんでした");
      return;
    }
    const created = await response.json();
    setMcpConnection(created);
    setRevealedMcpUrl(created.url);
  };
  const revokeMcpUrl = async () => {
    if (!confirm("このMCP接続URLを無効にしますか？ 接続中のMCPクライアントは利用できなくなります。")) return;
    const response = await apiFetch(`${API}/auth/mcp-connection`, {
      method: "DELETE",
    });
    if (response.ok) {
      setMcpConnection(null);
      setRevealedMcpUrl("");
      notify("MCP接続URLを無効にしました");
    }
  };
  const updateManagedUser = async (
    item: User,
    patch: Partial<Pick<User, "role" | "is_active">>,
  ) => {
    const response = await apiFetch(`${API}/admin/users/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (response.ok) {
      const updated = await response.json();
      setUsers((all) => all.map((x) => (x.id === updated.id ? updated : x)));
      notify("ユーザー権限を更新しました");
    } else notify("ユーザー権限を更新できませんでした");
  };
  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      name: String(fd.get("name")),
      type: fd.get("type") as Category["type"],
      color: String(fd.get("color") || CATEGORY_COLORS[0]),
    };
    const editing = categoryForm && categoryForm !== "new" ? categoryForm : null;
    try {
      let item: Category = editing
        ? { ...editing, ...payload }
        : { id: crypto.randomUUID(), ...payload };
      if (connected) {
        const response = await apiFetch(
          editing ? `${API}/categories/${editing.id}` : `${API}/categories`,
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (response.status === 409) {
          const body = await response.json().catch(() => ({}));
          const detail = String(body.detail || "");
          throw new Error(
            detail.includes("in use") ? "in-use-type" : "duplicate",
          );
        }
        if (!response.ok) throw new Error();
        item = await response.json();
      }
      setCategories((all) =>
        editing
          ? all.map((category) => (category.id === item.id ? item : category))
          : [...all, item],
      );
      setCategoryForm(null);
      notify(editing ? "カテゴリを更新しました" : "カテゴリを追加しました");
    } catch (error) {
      notify(
        error instanceof Error && error.message === "in-use-type"
          ? "取引で使っているカテゴリは種類を変更できません"
          : error instanceof Error && error.message === "duplicate"
            ? "同じ名前のカテゴリがあります"
            : editing
              ? "カテゴリを更新できませんでした"
              : "同じ名前のカテゴリがあるか、追加できませんでした",
      );
    }
  };
  const removeCategory = async (item: Category) => {
    if (!confirm(`「${item.name}」を削除しますか？`)) return;
    try {
      if (connected) {
        const response = await apiFetch(`${API}/categories/${item.id}`, {
          method: "DELETE",
        });
        if (response.status === 409) throw new Error("in-use");
        if (!response.ok) throw new Error();
      }
      setCategories((all) => all.filter((c) => c.id !== item.id));
      notify("カテゴリを削除しました");
    } catch (error) {
      notify(
        error instanceof Error && error.message === "in-use"
          ? "取引で使っているカテゴリは削除できません"
          : "カテゴリを削除できませんでした",
      );
    }
  };
  return (
    <div className="page settings-page">
      <PageHeader eyebrow="PREFERENCES" title="設定" />
      <section className="settings-section panel">
        <div>
          <h2>プロフィール</h2>
          <p>
            表示名と地域設定を編集できます。メールアドレスはログインIDとして保護されています。
          </p>
        </div>
        <div className="profile-row">
          <div className="avatar large-avatar">{user.name[0]}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
            <small className="role-badge">
              {user.role === "admin" ? "管理者" : "一般ユーザー"}
            </small>
          </div>
          <div className="profile-actions">
            <button className="secondary" onClick={() => setEditing(true)}>
              プロフィールを編集
            </button>
            <button className="secondary" onClick={() => setPasswordOpen(true)}>
              パスワード変更
            </button>
          </div>
        </div>
      </section>
      <section className="settings-section panel">
        <div>
          <h2>カテゴリ</h2>
          <p>
            取引の分類です。名前・色・種類を編集できます。使っていないものだけ削除できます。
          </p>
        </div>
        <div className="token-toolbar">
          <button className="secondary" onClick={() => setCategoryForm("new")}>
            ＋ カテゴリを追加
          </button>
        </div>
        <div className="category-manage">
          {(["expense", "income"] as const).map((type) => (
            <div key={type}>
              <h3>{type === "expense" ? "支出" : "収入"}</h3>
              {categories
                .filter((c) => c.type === type)
                .map((c) => (
                  <div className="category-item" key={c.id}>
                    <i style={{ background: c.color || "#aaa69f" }} />
                    <span>
                      {c.name}
                      {categoryColorLabel(c.color) ? (
                        <small> {categoryColorLabel(c.color)}</small>
                      ) : null}
                    </span>
                    <div className="category-item-actions">
                      <button
                        type="button"
                        className="inline-add"
                        onClick={() => setCategoryForm(c)}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        className="danger-link"
                        onClick={() => removeCategory(c)}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              {!categories.some((c) => c.type === type) && (
                <p className="muted-text">まだありません</p>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="settings-section panel">
        <div>
          <h2>MCP連携</h2>
          <p>
            Streamable HTTP対応のユーザー専用URLです。URLをMCPクライアントへ貼り付けるだけで接続でき、他ユーザーの情報にはアクセスできません。
          </p>
        </div>
        <div className="token-toolbar">
          <button className="secondary" onClick={issueMcpUrl}>
            {mcpConnection ? "新しいURLを再発行" : "接続URLを発行"}
          </button>
        </div>
        {revealedMcpUrl && (
          <div className="token-reveal">
            <strong>このURLは今だけ表示されます。MCPクライアントにそのまま貼り付けてください。</strong>
            <code>{revealedMcpUrl}</code>
            <button
              className="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(revealedMcpUrl)
                  .then(() => notify("MCP接続URLをコピーしました"))
              }
            >
              コピー
            </button>
          </div>
        )}
        <div className="token-list">
          {mcpConnection && (
            <div>
              <span>
                <strong>有効なStreamable HTTP接続URL</strong>
                <small>
                  {mcpConnection.secret_prefix}… · 発行日 {new Date(mcpConnection.created_at).toLocaleDateString("ja-JP")}
                </small>
              </span>
              <button className="danger-link" onClick={revokeMcpUrl}>
                無効化
              </button>
            </div>
          )}
          {!mcpConnection && (
            <p className="muted-text">有効なMCP接続URLはありません。</p>
          )}
        </div>
      </section>
      {user.role === "admin" ? (
        <>
          <section className="settings-section panel">
            <div>
              <h2>ユーザー管理</h2>
              <p>管理者のみ、利用者の権限と利用状態を変更できます。</p>
            </div>
            <div className="user-table">
              {users.map((item) => (
                <div key={item.id}>
                  <span className="avatar">{item.name[0]}</span>
                  <span>
                    <strong>
                      {item.name}
                      {item.id === user.id ? "（自分）" : ""}
                    </strong>
                    <small>{item.email}</small>
                  </span>
                  <select
                    aria-label={`${item.name}の権限`}
                    value={item.role}
                    onChange={(e) =>
                      updateManagedUser(item, {
                        role: e.target.value as User["role"],
                      })
                    }
                  >
                    <option value="user">一般ユーザー</option>
                    <option value="admin">管理者</option>
                  </select>
                  <label className="switch">
                    <input
                      aria-label={`${item.name}の利用状態`}
                      type="checkbox"
                      checked={item.is_active}
                      disabled={item.id === user.id}
                      onChange={(e) =>
                        updateManagedUser(item, { is_active: e.target.checked })
                      }
                    />
                    <span />
                  </label>
                </div>
              ))}
            </div>
          </section>
          <section className="settings-section panel backup-section">
            <div>
              <h2>管理者データツール</h2>
              <p>バックアップの作成と復元は管理者だけが実行できます。</p>
            </div>
            <div className="backup-actions">
              <article>
                <span className="backup-icon">↓</span>
                <div>
                  <strong>バックアップを書き出す</strong>
                  <p>
                    あなたの家計データをバージョン付きJSONとして保存します。
                  </p>
                </div>
                <button className="secondary" onClick={backup}>
                  ファイルを保存
                </button>
              </article>
              <article>
                <span className="backup-icon">↑</span>
                <div>
                  <strong>バックアップから復元</strong>
                  <p>検証後、現在の家計データを置き換えます。</p>
                </div>
                <input
                  ref={fileRef}
                  hidden
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => restore(e.target.files?.[0])}
                />
                <button
                  className="secondary"
                  disabled={restoring}
                  onClick={() => fileRef.current?.click()}
                >
                  {restoring ? "確認中…" : "ファイルを選択"}
                </button>
              </article>
            </div>
          </section>
          <section className="settings-section panel danger-zone">
            <div>
              <h2>家計データを削除</h2>
              <p>
                すべての口座・カテゴリ・取引・定期取引を削除します。ユーザーアカウントは残ります。
              </p>
            </div>
            <button className="danger-link" onClick={deleteAll}>
              すべての家計データを削除
            </button>
          </section>
        </>
      ) : (
        <section className="settings-section panel restricted-section">
          <span>🔒</span>
          <div>
            <h2>管理者向け機能</h2>
            <p>
              ユーザー管理、バックアップ、復元、一括削除は管理者だけが利用できます。
            </p>
          </div>
        </section>
      )}
      {editing && (
        <Modal title="プロフィールを編集" close={() => setEditing(false)}>
          <form className="modal-form" onSubmit={saveProfile}>
            <label>
              <span>表示名</span>
              <input name="name" required defaultValue={user.name} />
            </label>
            <label>
              <span>タイムゾーン</span>
              <select name="timezone" defaultValue={user.timezone}>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <label>
              <span>通貨</span>
              <select name="currency" defaultValue={user.currency}>
                <option value="JPY">日本円（JPY）</option>
                <option value="USD">米ドル（USD）</option>
                <option value="EUR">ユーロ（EUR）</option>
              </select>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(false)}
              >
                キャンセル
              </button>
              <button className="primary">保存</button>
            </div>
          </form>
        </Modal>
      )}
      {passwordOpen && (
        <Modal title="パスワードを変更" close={() => setPasswordOpen(false)}>
          <form className="modal-form" onSubmit={changePassword}>
            <label>
              <span>現在のパスワード</span>
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              <span>新しいパスワード</span>
              <input
                name="new_password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              <span>新しいパスワード（確認）</span>
              <input
                name="confirm_password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            <p className="form-help">
              10文字以上で、英字と数字を含めてください。
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setPasswordOpen(false)}
              >
                キャンセル
              </button>
              <button className="primary">変更する</button>
            </div>
          </form>
        </Modal>
      )}
      {categoryForm && (
        <Modal
          title={categoryForm === "new" ? "カテゴリを追加" : "カテゴリを編集"}
          close={() => setCategoryForm(null)}
        >
          <form className="modal-form" onSubmit={saveCategory}>
            <label>
              <span>名前</span>
              <input
                name="name"
                required
                maxLength={80}
                placeholder="例：医療費"
                defaultValue={
                  categoryForm === "new" ? "" : categoryForm.name
                }
              />
            </label>
            <label>
              <span>種類</span>
              <select
                name="type"
                defaultValue={
                  categoryForm === "new" ? "expense" : categoryForm.type
                }
              >
                <option value="expense">支出</option>
                <option value="income">収入</option>
              </select>
            </label>
            {categoryForm !== "new" && (
              <p className="form-help">
                取引や定期で使っているカテゴリは、種類を変更できません。
              </p>
            )}
            <ColorSwatchPicker
              name="color"
              defaultValue={
                categoryForm === "new"
                  ? nextCategoryColor(categories)
                  : categoryForm.color || nextCategoryColor(categories)
              }
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setCategoryForm(null)}
              >
                キャンセル
              </button>
              <button className="primary">
                {categoryForm === "new" ? "追加" : "変更を保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>{title}</h2>
          <button className="close" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
