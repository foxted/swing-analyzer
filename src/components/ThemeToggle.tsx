"use client";

import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "theme";
const ORDER: Theme[] = ["system", "light", "dark"];

/** Reads the saved choice; "system" when nothing is saved or storage is unavailable. */
function saved(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

/** Cycles system → light → dark. The inline script in layout.tsx applies the saved choice before paint. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(saved()), []);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const label = theme === "system" ? "Theme follows your system" : `Theme: ${theme}`;
  return (
    <button
      className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-panel text-muted transition-colors hover:border-line-strong hover:text-fg"
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
      title={`${label} · click for ${next}`}
      aria-label={`${label}. Switch to ${next}`}
    >
      {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Auto />}
    </button>
  );
}

const svg = { viewBox: "0 0 24 24", className: "size-4", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function Sun() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
function Moon() {
  return (
    <svg {...svg}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
function Auto() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
