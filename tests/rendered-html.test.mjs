import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the authenticated application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>tally — 今日の残高を、楽しみに開く<\/title>/i);
  assert.match(html, /安全なセッションを確認しています/);
  assert.match(html, /class="auth-shell"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("includes login, password recovery, profile, and role-aware management", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../app/wallet-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /mode === "register"/);
  assert.match(app, /\/auth\/forgot-password/);
  assert.match(app, /プロフィールを編集/);
  assert.match(app, /user\.role === "admin"/);
  assert.match(app, /MCP連携/);
  assert.match(css, /\.auth-shell/);
  assert.match(css, /@media \(max-width:760px\)/);
});
