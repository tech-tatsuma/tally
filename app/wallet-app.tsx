"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Account = { id: string; name: string; institution_name?: string; account_type: string; current_balance: number; initial_balance?: number; currency: string; description?: string };
type Category = { id: string; name: string; type: "income" | "expense"; color?: string };
type Transaction = { id: string; account_id: string; category_id?: string; type: "income" | "expense" | "transfer"; amount: number; occurred_at: string; title: string; description?: string; journal?: string; transfer_direction?: string };
type Recurring = { id: string; account_id: string; category_id?: string; type: "income" | "expense"; amount: number; title: string; description?: string; journal_template?: string; frequency: "monthly" | "yearly"; start_date?: string; end_date?: string; execution_day: number; next_execution_date: string; enabled: boolean };

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
const demoAccounts: Account[] = [
  { id: "a1", name: "メイン銀行", institution_name: "みらい銀行", account_type: "bank", current_balance: 1_248_320, currency: "JPY" },
  { id: "a2", name: "貯蓄口座", institution_name: "つばさ銀行", account_type: "bank", current_balance: 821_000, currency: "JPY" },
  { id: "a3", name: "現金", account_type: "cash", current_balance: 76_480, currency: "JPY" },
  { id: "a4", name: "投資", account_type: "investment", current_balance: 392_600, currency: "JPY" },
];
const demoCategories: Category[] = [
  { id: "c1", name: "食費", type: "expense", color: "#00c4cc" }, { id: "c2", name: "カフェ", type: "expense", color: "#ff9100" },
  { id: "c3", name: "住居費", type: "expense", color: "#2d4b9b" }, { id: "c4", name: "交通費", type: "expense", color: "#69d7ff" },
  { id: "c5", name: "娯楽", type: "expense", color: "#e65537" }, { id: "c6", name: "給与", type: "income", color: "#4bb47d" },
];
const now = new Date();
const dateBefore = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
const demoTransactions: Transaction[] = [
  { id: "t1", account_id: "a1", category_id: "c1", type: "expense", amount: 6800, occurred_at: dateBefore(0), title: "友人と夕食", description: "駅前のレストラン", journal: "久しぶりに友人と会えた。仕事の話をしながら、ゆっくり過ごせた夜。" },
  { id: "t2", account_id: "a1", category_id: "c2", type: "expense", amount: 520, occurred_at: dateBefore(1), title: "朝のコーヒー" },
  { id: "t3", account_id: "a1", category_id: "c6", type: "income", amount: 350000, occurred_at: dateBefore(3), title: "給与" },
  { id: "t4", account_id: "a1", category_id: "c4", type: "expense", amount: 12840, occurred_at: dateBefore(5), title: "電車の定期" },
  { id: "t5", account_id: "a1", category_id: "c3", type: "expense", amount: 80000, occurred_at: dateBefore(8), title: "家賃" },
  { id: "t6", account_id: "a3", category_id: "c5", type: "expense", amount: 1900, occurred_at: dateBefore(11), title: "映画" },
];
const demoRecurring: Recurring[] = [
  { id: "r1", account_id: "a1", category_id: "c3", type: "expense", amount: 80000, title: "家賃", frequency: "monthly", start_date: "2026-01-01", execution_day: 25, next_execution_date: "2026-08-25", enabled: true },
  { id: "r2", account_id: "a1", category_id: "c5", type: "expense", amount: 1490, title: "Netflix", frequency: "monthly", start_date: "2026-01-01", execution_day: 15, next_execution_date: "2026-09-15", enabled: true },
  { id: "r3", account_id: "a1", category_id: "c6", type: "income", amount: 350000, title: "給与", frequency: "monthly", start_date: "2026-01-01", execution_day: 25, next_execution_date: "2026-08-25", enabled: true },
];

const money = (value: number | string) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(value));
const shortDate = (value: string) => new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", weekday: "short" }).format(new Date(value));
const nav = [
  ["/dashboard", "⌂", "ホーム"], ["/transactions", "↕", "取引"], ["/accounts", "▣", "口座"], ["/recurring", "↻", "定期"], ["/analytics", "⌁", "分析"], ["/settings", "⚙", "設定"],
];

async function fetchAllTransactions(): Promise<Transaction[]> {
  const items: Transaction[] = []; let page = 1; let total = 0;
  do { const response = await fetch(`${API}/transactions?page=${page}&page_size=100`); if (!response.ok) throw new Error("transactions"); const payload = await response.json(); items.push(...payload.items); total = payload.total; page += 1; } while (items.length < total);
  return items;
}

function useRoute() {
  const [path, setPath] = useState("/dashboard");
  useEffect(() => { const sync = () => setPath(location.pathname === "/" ? "/dashboard" : location.pathname); sync(); addEventListener("popstate", sync); return () => removeEventListener("popstate", sync); }, []);
  const go = (next: string) => { history.pushState({}, "", next); setPath(next); scrollTo({ top: 0, behavior: "smooth" }); };
  return { path, go };
}

export function WalletApp() {
  const { path, go } = useRoute();
  const [accounts, setAccounts] = useState(demoAccounts);
  const [categories, setCategories] = useState(demoCategories);
  const [transactions, setTransactions] = useState(demoTransactions);
  const [recurring, setRecurring] = useState(demoRecurring);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };

  useEffect(() => {
    Promise.all([fetch(`${API}/accounts`), fetch(`${API}/categories`), fetchAllTransactions(), fetch(`${API}/recurring-transactions`)]).then(async ([a, c, t, r]) => {
      if (![a, c, r].every((x) => x.ok)) throw new Error();
      setAccounts(await a.json()); setCategories(await c.json()); setTransactions(t); setRecurring(await r.json()); setConnected(true);
    }).catch(() => setConnected(false));
  }, []);

  const active = nav.find(([href]) => path.startsWith(href) && href !== "/dashboard") || nav[0];
  const contentProps = { accounts, categories, transactions, recurring, connected, setTransactions, setAccounts, setRecurring, go, notify };
  let content = <Dashboard {...contentProps} />;
  if (path === "/transactions/new") content = <TransactionForm {...contentProps} />;
  else if (path.startsWith("/transactions")) content = <Transactions {...contentProps} />;
  else if (path.startsWith("/accounts/")) content = <AccountDetail {...contentProps} id={path.split("/")[2]} />;
  else if (path === "/accounts") content = <Accounts {...contentProps} />;
  else if (path === "/recurring") content = <RecurringPage {...contentProps} />;
  else if (path === "/analytics") content = <Analytics {...contentProps} />;
  else if (path === "/settings") content = <Settings connected={connected} notify={notify} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => go("/dashboard")}><span className="brand-mark">t</span><span>tally</span></button>
      <nav aria-label="メインナビゲーション">{nav.map(([href, icon, label]) => <button key={href} className={path.startsWith(href) && (href !== "/dashboard" || path === "/dashboard") ? "active" : ""} onClick={() => go(href)}><span aria-hidden>{icon}</span>{label}</button>)}</nav>
      <div className="sidebar-foot"><div className="avatar">T</div><div><strong>たつま</strong><span>{connected ? "データ同期中" : "デモモード"}</span></div></div>
    </aside>
    <main className="main"><header className="mobile-header"><button className="brand" onClick={() => go("/dashboard")}><span className="brand-mark">t</span><span>tally</span></button><span>{active[2]}</span></header>{content}</main>
    <nav className="mobile-nav" aria-label="モバイルナビゲーション">{nav.slice(0, 5).map(([href, icon, label]) => <button key={href} className={path.startsWith(href) && (href !== "/dashboard" || path === "/dashboard") ? "active" : ""} onClick={() => go(href)}><span aria-hidden>{icon}</span><small>{label}</small></button>)}</nav>
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </div>;
}

type PageProps = {
  accounts: Account[]; categories: Category[]; transactions: Transaction[]; recurring: Recurring[]; connected: boolean;
  setTransactions: (value: Transaction[] | ((current: Transaction[]) => Transaction[])) => void;
  setAccounts: (value: Account[] | ((current: Account[]) => Account[])) => void;
  setRecurring: (value: Recurring[] | ((current: Recurring[]) => Recurring[])) => void;
  go: (path: string) => void; notify: (message: string) => void;
};

function PageHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>{action}</div>;
}

function Dashboard({ accounts, categories, transactions, go }: PageProps) {
  const assets = accounts.reduce((n, a) => n + Number(a.current_balance), 0);
  const monthIncome = transactions.filter((t) => t.type === "income").reduce((n, t) => n + Number(t.amount), 0);
  const monthExpense = transactions.filter((t) => t.type === "expense").reduce((n, t) => n + Number(t.amount), 0);
  return <div className="page dashboard-page">
    <PageHeader eyebrow="2026年8月14日 金曜日" title="おかえりなさい、たつまさん" action={<button className="primary" onClick={() => go("/transactions/new")}>＋ 取引を追加</button>} />
    <section className="asset-hero"><div><p>現在の総資産</p><strong>{money(assets)}</strong><span className="positive">↑ 5.2% <small>先月比</small></span></div><MiniLine /></section>
    <section className="metric-grid"><Metric label="今月の収入" value={money(monthIncome)} note="先月と同程度" tone="income" /><Metric label="今月の支出" value={money(monthExpense)} note="予算の 42%" tone="expense" /><Metric label="今月の収支" value={money(monthIncome - monthExpense)} note="貯蓄率 71%" tone="balance" /></section>
    <div className="dashboard-grid">
      <section className="panel span-2"><SectionHead title="資産の推移" link="詳しく見る" onClick={() => go("/analytics")} /><div className="trend-summary"><strong>{money(assets)}</strong><span className="positive">＋{money(126400)}（6ヶ月）</span></div><AssetChart /></section>
      <section className="panel accounts-panel"><SectionHead title="口座別残高" link="口座を管理" onClick={() => go("/accounts")} /><div className="account-list">{accounts.map((a, i) => <button key={a.id} onClick={() => go(`/accounts/${a.id}`)}><span className={`account-icon icon-${i}`}>{a.name[0]}</span><span><strong>{a.name}</strong><small>{a.institution_name || a.account_type}</small></span><b>{money(a.current_balance)}</b></button>)}</div></section>
      <section className="panel span-2"><SectionHead title="最近の取引" link="すべて見る" onClick={() => go("/transactions")} /><TransactionList items={transactions.slice(0, 5)} accounts={accounts} categories={categories} onClick={() => go("/transactions")} /></section>
      <section className="panel journal-card"><p className="eyebrow">TODAY&apos;S NOTE</p><h2>お金と一緒に、今日を残す</h2><p>取引の記録には、その日の出来事や気持ちも書き残せます。</p><button className="secondary" onClick={() => go("/transactions/new")}>今日の記録を書く →</button></section>
    </div>
  </div>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function SectionHead({ title, link, onClick }: { title: string; link?: string; onClick?: () => void }) { return <div className="section-head"><h2>{title}</h2>{link && <button onClick={onClick}>{link} →</button>}</div>; }

function MiniLine() { return <div className="mini-bars" aria-label="直近の資産は増加傾向">{[30, 38, 34, 48, 52, 61, 58, 75, 80, 94].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>; }
function AssetChart() {
  return <div className="chart-wrap"><div className="chart-y"><span>250万</span><span>230万</span><span>210万</span><span>190万</span></div><svg viewBox="0 0 700 180" role="img" aria-label="2月から8月にかけて総資産が増加"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#00c4cc" stopOpacity=".28"/><stop offset="1" stopColor="#00c4cc" stopOpacity="0"/></linearGradient></defs><path className="area" d="M0,150 C70,145 80,125 140,130 S230,98 280,108 S370,75 420,82 S500,62 560,65 S640,25 700,30 L700,180 L0,180Z"/><path className="line" d="M0,150 C70,145 80,125 140,130 S230,98 280,108 S370,75 420,82 S500,62 560,65 S640,25 700,30"/></svg><div className="chart-x"><span>2月</span><span>3月</span><span>4月</span><span>5月</span><span>6月</span><span>7月</span><span>8月</span></div></div>;
}

function TransactionList({ items, accounts, categories, onClick }: { items: Transaction[]; accounts: Account[]; categories: Category[]; onClick?: (t: Transaction) => void }) {
  return <div className="transaction-list">{items.map((t) => { const category = categories.find((c) => c.id === t.category_id); return <button key={t.id} onClick={() => onClick?.(t)}><span className="date-cell">{shortDate(t.occurred_at)}</span><span className="category-dot" style={{ background: category?.color || "#aaa69f" }}>{(category?.name || "振")[0]}</span><span className="transaction-main"><strong>{t.title}</strong><small>{category?.name || "口座振替"} · {accounts.find((a) => a.id === t.account_id)?.name}</small></span><b className={t.type === "income" ? "amount-in" : ""}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</b></button>; })}</div>;
}

function Transactions({ accounts, categories, transactions, setTransactions, go, notify, connected }: PageProps) {
  const [query, setQuery] = useState(""); const [type, setType] = useState("all"); const [selected, setSelected] = useState<Transaction | null>(null);
  const filtered = transactions.filter((t) => (type === "all" || t.type === type) && t.title.toLowerCase().includes(query.toLowerCase()));
  const remove = async (t: Transaction) => { if (!confirm(`「${t.title}」を削除しますか？`)) return; if (connected) await fetch(`${API}/transactions/${t.id}`, { method: "DELETE" }); setTransactions((all) => all.filter((x) => x.id !== t.id)); setSelected(null); notify("取引を削除しました"); };
  return <div className="page"><PageHeader eyebrow="MONEY & MOMENTS" title="取引" action={<button className="primary" onClick={() => go("/transactions/new")}>＋ 取引を追加</button>} />
    <div className="filter-bar"><label className="search"><span>⌕</span><input aria-label="取引を検索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タイトルやメモを検索" /></label><div className="segmented"><button className={type === "all" ? "active" : ""} onClick={() => setType("all")}>すべて</button><button className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>支出</button><button className={type === "income" ? "active" : ""} onClick={() => setType("income")}>収入</button></div><button className="secondary">日付・口座で絞る</button></div>
    <section className="panel"><div className="table-caption"><span>{filtered.length}件の取引</span><span>新しい順</span></div><TransactionList items={filtered} accounts={accounts} categories={categories} onClick={setSelected} /></section>
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="close" aria-label="閉じる" onClick={() => setSelected(null)}>×</button><p className="eyebrow">TRANSACTION DETAIL</p><h2>{selected.title}</h2><strong className={`detail-amount ${selected.type === "income" ? "amount-in" : ""}`}>{selected.type === "income" ? "+" : "−"}{money(selected.amount)}</strong><dl><div><dt>日付</dt><dd>{shortDate(selected.occurred_at)}</dd></div><div><dt>カテゴリ</dt><dd>{categories.find((c) => c.id === selected.category_id)?.name || "振替"}</dd></div><div><dt>口座</dt><dd>{accounts.find((a) => a.id === selected.account_id)?.name}</dd></div></dl>{selected.description && <div className="detail-block"><small>説明</small><p>{selected.description}</p></div>}{selected.journal && <div className="journal-detail"><small>この日の記録</small><p>{selected.journal}</p></div>}<div className="drawer-actions"><button className="secondary">編集</button><button className="danger-link" onClick={() => remove(selected)}>削除</button></div></aside></div>}
  </div>;
}

function TransactionForm({ accounts, categories, setTransactions, go, notify, connected }: PageProps) {
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense"); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); const fd = new FormData(event.currentTarget);
    const payload = { type: kind, amount: fd.get("amount"), occurred_at: new Date(`${fd.get("date")}T12:00:00+09:00`).toISOString(), account_id: fd.get("account_id"), destination_account_id: kind === "transfer" ? fd.get("destination_account_id") : null, category_id: kind === "transfer" ? null : fd.get("category_id"), title: fd.get("title"), description: fd.get("description"), journal: fd.get("journal") };
    try { let tx: Transaction = { ...payload, id: crypto.randomUUID(), amount: Number(payload.amount) } as Transaction; if (connected) { const r = await fetch(`${API}/transactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!r.ok) throw new Error(await r.text()); tx = await r.json(); } setTransactions((all) => [tx, ...all]); notify("取引を保存しました"); go("/transactions"); } catch { notify("保存できませんでした。入力内容を確認してください"); } finally { setSaving(false); }
  };
  const visibleCategories = categories.filter((c) => c.type === kind);
  return <div className="page form-page"><button className="back-link" onClick={() => go("/transactions")}>← 取引一覧へ</button><PageHeader eyebrow="NEW TRANSACTION" title="取引を記録する" /><form className="transaction-form panel" onSubmit={submit}><div className="type-switch"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}>支出</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}>収入</button><button type="button" className={kind === "transfer" ? "active" : ""} onClick={() => setKind("transfer")}>振替</button></div>
    <label className="amount-field"><span>金額</span><div><b>¥</b><input required autoFocus name="amount" type="number" inputMode="numeric" min="1" step="1" placeholder="0" /></div></label>
    <div className="form-grid"><label><span>日付</span><input required name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>口座</span><select required name="account_id" defaultValue={accounts[0]?.id}>{accounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>{kind === "transfer" ? <label><span>振替先口座</span><select required name="destination_account_id" defaultValue={accounts[1]?.id}>{accounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label> : <label><span>カテゴリ</span><select required name="category_id" defaultValue={visibleCategories[0]?.id}>{visibleCategories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}<label className="full"><span>タイトル</span><input required name="title" maxLength={160} placeholder={kind === "income" ? "例：給与" : "例：友人と夕食"} /></label><label className="full"><span>説明 <small>任意</small></span><textarea name="description" rows={2} placeholder="場所や用途など、短いメモ" /></label></div>
    <div className="journal-input"><div><span className="journal-icon">✎</span><div><strong>この日のことを残す</strong><p>この取引にまつわる出来事や、感じたことを書いてみましょう。</p></div></div><textarea name="journal" rows={6} placeholder="今日は仕事帰りに友人と夕食。久しぶりに会えて楽しかった…" /></div>
    <div className="form-actions"><button type="button" className="secondary" onClick={() => go("/transactions")}>キャンセル</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "記録を保存"}</button></div></form></div>;
}

function Accounts({ accounts, setAccounts, go, notify, connected }: PageProps) {
  const [open, setOpen] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); let item: Account = { id: crypto.randomUUID(), name: String(fd.get("name")), account_type: String(fd.get("account_type")), current_balance: Number(fd.get("initial_balance")), currency: "JPY", institution_name: String(fd.get("institution_name") || "") }; if (connected) { const r = await fetch(`${API}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...item, initial_balance: item.current_balance }) }); item = await r.json(); } setAccounts((all) => [...all, item]); setOpen(false); notify("口座を追加しました"); };
  return <div className="page"><PageHeader eyebrow="MY ASSETS" title="口座" action={<button className="primary" onClick={() => setOpen(true)}>＋ 口座を追加</button>} /><div className="account-summary"><span>総資産</span><strong>{money(accounts.reduce((n, a) => n + Number(a.current_balance), 0))}</strong><small>{accounts.length}口座</small></div><div className="account-cards">{accounts.map((a, i) => <button key={a.id} className="account-card panel" onClick={() => go(`/accounts/${a.id}`)}><span className={`account-icon large icon-${i}`}>{a.name[0]}</span><span><small>{a.institution_name || a.account_type}</small><h2>{a.name}</h2></span><strong>{money(a.current_balance)}</strong><em>詳細を見る →</em></button>)}</div>{open && <Modal title="口座を追加" close={() => setOpen(false)}><form onSubmit={submit} className="modal-form"><label><span>口座名</span><input required name="name" placeholder="例：生活口座" /></label><label><span>金融機関名</span><input name="institution_name" placeholder="例：みらい銀行" /></label><label><span>口座タイプ</span><select name="account_type"><option value="bank">銀行</option><option value="cash">現金</option><option value="wallet">電子マネー</option><option value="investment">投資</option><option value="other">その他</option></select></label><label><span>初期残高</span><input required name="initial_balance" type="number" min="0" defaultValue="0" /></label><button className="primary">追加する</button></form></Modal>}</div>;
}

function AccountDetail({ id, accounts, categories, transactions, setAccounts, go, notify, connected }: PageProps & { id: string }) {
  const [editing, setEditing] = useState(false);
  const account = accounts.find((a) => a.id === id); if (!account) return <div className="page empty"><h1>口座が見つかりません</h1><button onClick={() => go("/accounts")}>口座一覧へ</button></div>;
  const items = transactions.filter((t) => t.account_id === id);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const fd = new FormData(event.currentTarget); const payload = { name: fd.get("name"), institution_name: fd.get("institution_name") || null, description: fd.get("description") || null }; try { let updated = { ...account, ...payload } as Account; if (connected) { const response = await fetch(`${API}/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(); updated = await response.json(); } setAccounts((all) => all.map((item) => item.id === account.id ? updated : item)); setEditing(false); notify("口座情報を更新しました"); } catch { notify("口座情報を更新できませんでした"); } };
  const archive = async () => { if (!confirm(`「${account.name}」をアーカイブしますか？取引履歴は残ります。`)) return; try { if (connected) { const response = await fetch(`${API}/accounts/${account.id}`, { method: "DELETE" }); if (!response.ok) throw new Error(); } setAccounts((all) => all.filter((item) => item.id !== account.id)); notify("口座をアーカイブしました"); go("/accounts"); } catch { notify("口座をアーカイブできませんでした"); } };
  return <div className="page"><button className="back-link" onClick={() => go("/accounts")}>← 口座一覧へ</button><PageHeader eyebrow={account.institution_name || account.account_type} title={account.name} action={<button className="secondary" onClick={() => setEditing(true)}>口座を編集</button>} /><section className="account-detail-hero"><span>現在残高</span><strong>{money(account.current_balance)}</strong><small>取引履歴から自動計算</small></section><div className="dashboard-grid"><section className="panel span-2"><SectionHead title="残高の推移" /><AssetChart /></section><section className="panel span-2"><SectionHead title="この口座の取引" /><TransactionList items={items} accounts={accounts} categories={categories} /></section></div>{editing && <Modal title="口座を編集" close={() => setEditing(false)}><form className="modal-form" onSubmit={save}><label><span>口座名</span><input required name="name" defaultValue={account.name} /></label><label><span>金融機関名</span><input name="institution_name" defaultValue={account.institution_name || ""} /></label><label><span>説明</span><textarea name="description" rows={3} defaultValue={account.description || ""} /></label><div className="modal-actions"><button type="button" className="danger-link" onClick={archive}>アーカイブ</button><button className="primary">変更を保存</button></div></form></Modal>}</div>;
}

function RecurringPage({ recurring, accounts, categories, setRecurring, notify, connected }: PageProps) {
  const [editing, setEditing] = useState<Recurring | "new" | null>(null); const [menu, setMenu] = useState<string | null>(null);
  const toggle = async (item: Recurring) => { const enabled = !item.enabled; try { if (connected) { const response = await fetch(`${API}/recurring-transactions/${item.id}/${enabled ? "enable" : "disable"}`, { method: "POST" }); if (!response.ok) throw new Error(); } setRecurring((all) => all.map((x) => x.id === item.id ? { ...x, enabled } : x)); notify(enabled ? "定期取引を再開しました" : "定期取引を停止しました"); } catch { notify("状態を変更できませんでした"); } };
  const remove = async (item: Recurring) => { setMenu(null); if (!confirm(`「${item.title}」の定期取引を削除しますか？`)) return; try { if (connected) { const response = await fetch(`${API}/recurring-transactions/${item.id}`, { method: "DELETE" }); if (!response.ok) throw new Error(); } setRecurring((all) => all.filter((x) => x.id !== item.id)); notify("定期取引を削除しました"); } catch { notify("定期取引を削除できませんでした"); } };
  return <div className="page"><PageHeader eyebrow="AUTOMATION" title="固定費・定期収入" action={<button className="primary" onClick={() => setEditing("new")}>＋ 定期取引を追加</button>} /><div className="info-banner"><span>↻</span><p><strong>毎月の記録を自動化</strong>　設定した日に取引が自動で作成されます。二重登録はされません。</p></div><section className="panel recurring-list"><div className="table-caption"><span>{recurring.length}件の定期取引</span><span>次回実行日順</span></div>{recurring.map((r) => <article key={r.id} className={!r.enabled ? "disabled" : ""}><span className="recurring-icon">{r.type === "income" ? "+" : "↻"}</span><div><h2>{r.title}</h2><p>{categories.find((c) => c.id === r.category_id)?.name} · {accounts.find((a) => a.id === r.account_id)?.name}</p></div><strong className={r.type === "income" ? "amount-in" : ""}>{r.type === "income" ? "+" : "−"}{money(r.amount)}</strong><div className="schedule"><b>{r.frequency === "yearly" ? "毎年" : "毎月"} {r.execution_day}日</b><small>次回 {r.next_execution_date.replaceAll("-", "/")}</small></div><label className="switch"><input aria-label={`${r.title}を${r.enabled ? "停止" : "再開"}`} type="checkbox" checked={r.enabled} onChange={() => toggle(r)} /><span /></label><div className="recurring-actions"><button className="more" aria-expanded={menu === r.id} aria-label={`${r.title}のメニュー`} onClick={() => setMenu(menu === r.id ? null : r.id)}>•••</button>{menu === r.id && <div className="action-menu"><button onClick={() => { setEditing(r); setMenu(null); }}>編集</button><button className="danger-menu" onClick={() => remove(r)}>削除</button></div>}</div></article>)}</section>{editing && <RecurringEditor item={editing === "new" ? undefined : editing} accounts={accounts} categories={categories} connected={connected} close={() => setEditing(null)} saved={(item) => { setRecurring((all) => editing === "new" ? [...all, item] : all.map((x) => x.id === item.id ? item : x)); setEditing(null); notify(editing === "new" ? "定期取引を追加しました" : "定期取引を更新しました"); }} />}</div>;
}

function Analytics({ transactions, categories }: PageProps) {
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const relevant = useMemo(() => transactions.filter((t) => t.type !== "transfer"), [transactions]);
  const totals = useMemo(() => relevant.reduce((sum, t) => ({ ...sum, [t.type]: sum[t.type as "income" | "expense"] + Number(t.amount) }), { income: 0, expense: 0 }), [relevant]);
  const rows = useMemo(() => { const grouped = new Map<string, { label: string; income: number; expense: number }>(); relevant.forEach((t) => { const d = new Date(t.occurred_at); const key = period === "daily" ? d.toISOString().slice(0, 10) : period === "monthly" ? d.toISOString().slice(0, 7) : String(d.getFullYear()); const label = period === "daily" ? `${d.getMonth() + 1}/${d.getDate()}` : period === "monthly" ? `${d.getFullYear()}年${d.getMonth() + 1}月` : `${d.getFullYear()}年`; const row = grouped.get(key) || { label, income: 0, expense: 0 }; row[t.type as "income" | "expense"] += Number(t.amount); grouped.set(key, row); }); return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, ...value, net: value.income - value.expense })); }, [relevant, period]);
  const maxValue = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense])); const visibleRows = period === "daily" ? rows.slice(-14) : rows;
  const categoryTotals = categories.filter((c) => c.type === "expense").map((c) => ({ ...c, amount: relevant.filter((t) => t.type === "expense" && t.category_id === c.id).reduce((n, t) => n + Number(t.amount), 0) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const savingsRate = totals.income ? Math.round(((totals.income - totals.expense) / totals.income) * 100) : 0;
  return <div className="page"><PageHeader eyebrow="INSIGHTS" title="収支分析" /><div className="analysis-controls"><div className="segmented"><button className={period === "daily" ? "active" : ""} onClick={() => setPeriod("daily")}>日次</button><button className={period === "monthly" ? "active" : ""} onClick={() => setPeriod("monthly")}>月次</button><button className={period === "yearly" ? "active" : ""} onClick={() => setPeriod("yearly")}>年次</button></div><span className="data-note">登録済み取引 {relevant.length}件を集計</span></div><section className="metric-grid"><Metric label="収入" value={money(totals.income)} note={`${relevant.filter((t) => t.type === "income").length}件の収入`} tone="income"/><Metric label="支出" value={money(totals.expense)} note={`${relevant.filter((t) => t.type === "expense").length}件の支出`} tone="expense"/><Metric label="純収支" value={money(totals.income - totals.expense)} note={`貯蓄率 ${savingsRate}%`} tone="balance"/></section><div className="analytics-grid"><section className="panel span-2"><SectionHead title="収入と支出" />{visibleRows.length ? <><div className="bar-chart">{visibleRows.map((r) => <div key={r.key}><span><i className="income-bar" title={`収入 ${money(r.income)}`} style={{ height: `${Math.max(r.income ? 3 : 0, r.income / maxValue * 100)}%` }}/><i className="expense-bar" title={`支出 ${money(r.expense)}`} style={{ height: `${Math.max(r.expense ? 3 : 0, r.expense / maxValue * 100)}%` }}/></span><small>{r.label.replace(/^\d{4}年/, "")}</small></div>)}</div><div className="legend"><span><i className="income-color"/>収入</span><span><i className="expense-color"/>支出</span></div><div className="analysis-table-wrap"><table className="analysis-table"><thead><tr><th>期間</th><th>収入</th><th>支出</th><th>純収支</th></tr></thead><tbody>{[...rows].reverse().map((r) => <tr key={r.key}><td>{r.label}</td><td className="amount-in">{money(r.income)}</td><td>{money(r.expense)}</td><td className={r.net >= 0 ? "amount-in" : ""}>{money(r.net)}</td></tr>)}</tbody></table></div></> : <p className="empty-chart">集計できる取引がありません。</p>}</section><section className="panel category-analysis"><SectionHead title="カテゴリ別支出" /><div className="donut" aria-label="カテゴリ別支出の円グラフ"><strong>合計<em>{money(categoryTotals.reduce((n, c) => n + c.amount, 0))}</em></strong></div>{categoryTotals.slice(0, 5).map((c) => <div className="category-row" key={c.id}><i style={{ background: c.color }}/><span>{c.name}</span><strong>{money(c.amount)}</strong></div>)}</section></div></div>;
}

function RecurringEditor({ item, accounts, categories, connected, close, saved }: { item?: Recurring; accounts: Account[]; categories: Category[]; connected: boolean; close: () => void; saved: (item: Recurring) => void }) {
  const [kind, setKind] = useState<"income" | "expense">(item?.type || "expense"); const [saving, setSaving] = useState(false); const start = item?.start_date || new Date().toISOString().slice(0, 10);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); const fd = new FormData(event.currentTarget); const payload = { account_id: fd.get("account_id"), category_id: fd.get("category_id"), type: kind, amount: fd.get("amount"), title: fd.get("title"), description: fd.get("description") || null, journal_template: fd.get("journal_template") || null, frequency: fd.get("frequency"), start_date: fd.get("start_date"), end_date: fd.get("end_date") || null, execution_day: Number(fd.get("execution_day")), enabled: item?.enabled ?? true }; try { let result: Recurring = { id: item?.id || crypto.randomUUID(), next_execution_date: start, ...payload, amount: Number(payload.amount) } as Recurring; if (connected) { const response = await fetch(`${API}/recurring-transactions${item ? `/${item.id}` : ""}`, { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(await response.text()); result = await response.json(); } saved(result); } catch { alert("入力内容を確認してください。口座とカテゴリの種類が一致している必要があります。"); } finally { setSaving(false); } };
  const filtered = categories.filter((c) => c.type === kind);
  return <Modal title={item ? "定期取引を編集" : "定期取引を追加"} close={close}><form className="modal-form recurring-form" onSubmit={submit}><div className="type-switch"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => setKind("expense")}>支出</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => setKind("income")}>収入</button></div><label><span>タイトル</span><input required name="title" defaultValue={item?.title || ""} placeholder="例：家賃" /></label><div className="inline-fields"><label><span>金額</span><input required name="amount" type="number" min="1" defaultValue={item?.amount || ""} /></label><label><span>実行日</span><input required name="execution_day" type="number" min="1" max="31" defaultValue={item?.execution_day || 25} /></label></div><div className="inline-fields"><label><span>口座</span><select name="account_id" defaultValue={item?.account_id || accounts[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label><span>カテゴリ</span><select name="category_id" defaultValue={item?.category_id || filtered[0]?.id}>{filtered.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div><div className="inline-fields"><label><span>頻度</span><select name="frequency" defaultValue={item?.frequency || "monthly"}><option value="monthly">毎月</option><option value="yearly">毎年</option></select></label><label><span>開始日</span><input required name="start_date" type="date" defaultValue={start} /></label></div><label><span>終了日 <small>任意</small></span><input name="end_date" type="date" defaultValue={item?.end_date || ""} /></label><label><span>説明</span><textarea name="description" rows={2} defaultValue={item?.description || ""} /></label><label><span>日記テンプレート</span><textarea name="journal_template" rows={3} defaultValue={item?.journal_template || ""} /></label><div className="modal-actions"><button type="button" className="secondary" onClick={close}>キャンセル</button><button className="primary" disabled={saving}>{saving ? "保存中…" : "保存"}</button></div></form></Modal>;
}

function Settings({ connected, notify }: { connected: boolean; notify: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null); const [restoring, setRestoring] = useState(false);
  const backup = async () => { try { let data: object = { schema_version: 1, exported_at: new Date().toISOString(), data: { accounts: demoAccounts, categories: demoCategories, recurring_transactions: demoRecurring, transactions: demoTransactions } }; if (connected) { const r = await fetch(`${API}/backup`); data = await r.json(); } const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `tally-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); notify("バックアップを書き出しました"); } catch { notify("バックアップに失敗しました"); } };
  const restore = async (file?: File) => { if (!file) return; if (!confirm("現在のデータをバックアップ内容で置き換えます。続けますか？")) return; setRestoring(true); try { const payload = JSON.parse(await file.text()); if (payload.schema_version !== 1 || !payload.data) throw new Error(); if (connected) { const r = await fetch(`${API}/backup/restore?confirm=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!r.ok) throw new Error(); } notify("バックアップを復元しました。画面を更新します"); if (connected) setTimeout(() => location.reload(), 800); } catch { notify("このバックアップは復元できませんでした"); } finally { setRestoring(false); if (fileRef.current) fileRef.current.value = ""; } };
  return <div className="page settings-page"><PageHeader eyebrow="PREFERENCES" title="設定" /><section className="settings-section panel"><div><h2>プロフィール</h2><p>将来の認証追加に備え、データはユーザー単位で分離されています。</p></div><div className="profile-row"><div className="avatar large-avatar">T</div><div><strong>たつま</strong><span>tatsuma@example.com</span></div><button className="secondary">編集</button></div></section><section className="settings-section panel"><div><h2>表示と地域</h2><p>金額や日付の表示設定です。</p></div><dl className="setting-list"><div><dt>通貨</dt><dd>日本円（JPY）</dd></div><div><dt>タイムゾーン</dt><dd>Asia/Tokyo</dd></div><div><dt>週の開始日</dt><dd>月曜日</dd></div></dl></section><section className="settings-section panel backup-section"><div><h2>データのバックアップ</h2><p>口座、カテゴリ、取引、定期取引をバージョン付きJSONとして安全に保存・復元できます。</p></div><div className="backup-actions"><article><span className="backup-icon">↓</span><div><strong>バックアップを書き出す</strong><p>現在のすべてのデータを1つのファイルに保存します。</p></div><button className="secondary" onClick={backup}>ファイルを保存</button></article><article><span className="backup-icon">↑</span><div><strong>バックアップから復元</strong><p>ファイルを検証後、現在のデータを置き換えます。</p></div><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(e) => restore(e.target.files?.[0])}/><button className="secondary" disabled={restoring} onClick={() => fileRef.current?.click()}>{restoring ? "確認中…" : "ファイルを選択"}</button></article></div><p className="warning-note">復元前には、現在のデータもバックアップしておくことをおすすめします。</p></section><section className="settings-section panel danger-zone"><div><h2>データ管理</h2><p>取り消せない操作です。実行前にバックアップしてください。</p></div><button className="danger-link">すべてのデータを削除</button></section></div>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onClick={close}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="section-head"><h2>{title}</h2><button className="close" onClick={close}>×</button></div>{children}</div></div>; }
