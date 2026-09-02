import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研发台账测算 | 研发智能体",
  description: "上传工资表、工时表、明细账和科目余额表，在浏览器本地完成研发台账测算。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
