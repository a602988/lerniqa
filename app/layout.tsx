import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Lerniqa｜學睿卡",description:"AI 個人化練習與錯題整理平台"};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-Hant"><body>{children}</body></html>}
