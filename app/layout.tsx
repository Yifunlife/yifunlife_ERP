import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yifun Life · 智能报价中心",
  description: "亦玩游乐产品选品与专业报价系统",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Yifun Life · 智能报价中心",
    description: "选产品、组方案，一键生成专业报价。",
  },
  twitter: {
    card: "summary_large_image",
    title: "Yifun Life · 智能报价中心",
    description: "选产品、组方案，一键生成专业报价。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
