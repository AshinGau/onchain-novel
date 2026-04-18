import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

import { NavBar } from "@/components/nav-bar";
import { Providers } from "@/components/providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Onchain Novel",
  description: "Decentralized collaborative novel protocol",
};

// Runs synchronously as the first thing inside <body>, which the HTML parser
// executes before painting any sibling content. Sets `.dark` on <html> based
// on localStorage > prefers-color-scheme > dark default, matching what
// ThemeToggle will later decide — no flash.
//
// Note: App Router owns <head>; adding our own produces a second <head> that
// breaks React hydration. Keep this script as a body child.
const noFoucScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <script dangerouslySetInnerHTML={{ __html: noFoucScript }} />
        <Providers>
          <NavBar />
          <main style={{ flex: 1 }}>{children}</main>
          <footer
            style={{
              borderTop: "1px solid var(--color-border)",
              padding: "1.5rem",
              textAlign: "center",
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
            }}
          >
            Onchain Novel Protocol
          </footer>
        </Providers>
      </body>
    </html>
  );
}
