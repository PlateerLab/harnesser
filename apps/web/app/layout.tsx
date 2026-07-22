import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harnesser",
  description: "코딩 테스트 & AI 활용 평가 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
