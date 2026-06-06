import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "trashchat",
  description: "Realtime chat for Chen and Zuo"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
