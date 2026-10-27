import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Swing Analyzer",
  description: "Local golf swing analysis: pose, P1-P6, score",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
