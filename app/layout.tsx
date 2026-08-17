import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: "tally — 今日の残高を、楽しみに開く",
  description: "家計、資産、日々の記録をひとつに。毎日の資産管理を楽しく見るアプリ",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "tally", description: "今日の残高を、楽しみに開く。", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "tally", description: "今日の残高を、楽しみに開く。", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
