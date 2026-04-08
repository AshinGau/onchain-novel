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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <Providers>
          <NavBar />
          <main style={{ flex: 1 }}>{children}</main>
          <footer style={{
            borderTop: "1px solid var(--color-border)",
            padding: "1.5rem",
            textAlign: "center",
            fontSize: "0.875rem",
            color: "var(--color-text-muted)",
          }}>
            Onchain Novel Protocol
          </footer>
        </Providers>
      </body>
    </html>
  );
}
