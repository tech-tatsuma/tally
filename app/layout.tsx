import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: "tally — お金と今日を記録する",
  description: "家計簿、資産管理、日記をひとつにまとめた個人向けアプリ",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "tally", description: "お金と今日を、ひとつに。", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "tally", description: "お金と今日を、ひとつに。", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
