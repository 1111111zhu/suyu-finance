import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研发成本测算操作台",
  description: "在浏览器本地完成研发成本测算，文件不上传到服务器。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
