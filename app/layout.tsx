import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Lerniqa｜考卷出題練習",
    description: "用歷屆考卷建立指定範圍的自主練習題。",
    icons: {
        icon: [
            { url: "/lerniqa-mark.svg", type: "image/svg+xml", sizes: "any" },
            { url: "/favicon.ico", sizes: "32x32" },
        ],
        apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
};

/**
 * 建立全站文件骨架並設定 Keel 主題軸。
 *
 * @param props 根版面配置。
 * @returns 套用全站主題的 HTML 文件。
 */
export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="zh-Hant"
            data-color-scheme="light"
            data-density="comfortable"
            data-radius="lg"
            data-skin="green"
        >
            <body>{children}</body>
        </html>
    );
}
