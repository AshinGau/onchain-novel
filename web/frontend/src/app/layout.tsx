import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/nav-bar";
import { Providers } from "@/components/providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Onchain Novel",
  description: "Read and participate in collaborative on-chain novels",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="d-flex flex-column min-vh-100">
        <Providers>
          <NavBar />
          <main className="flex-grow-1">{children}</main>
          <footer className="border-top py-4 text-center small text-body-tertiary">
            Onchain Novel Protocol
          </footer>
        </Providers>
      </body>
    </html>
  );
}
