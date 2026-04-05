"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <span className="btn btn-link p-1" />;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="btn btn-link text-body p-1"
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <i className={`bi ${isDark ? "bi-sun-fill" : "bi-moon-fill"}`} />
    </button>
  );
}
