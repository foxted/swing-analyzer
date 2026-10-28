import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Swing Analysis · Roundr",
  description: "Local golf swing analysis: pose, P1-P6, score, ball tracer",
};

/* Applies a saved light/dark choice before first paint so there is no flash; without one the CSS follows the OS. */
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
