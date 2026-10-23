import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Container } from "@/components/layout/Container";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { publicEnv } from "@/lib/env/public";
import { AppProviders } from "@/providers/AppProviders";
import "./globals.css";

// Self-hosted at build time by next/font (no request to Google from the browser).
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  ...(publicEnv.siteUrl ? { metadataBase: publicEnv.siteUrl } : {}),
  title: { default: publicEnv.appName, template: `%s · ${publicEnv.appName}` },
  description: "Online store",
  // Safari/WebKit otherwise turns phone numbers, dates and addresses in
  // server-rendered text into links before React hydrates (hydration errors).
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-background px-4 py-3 font-semibold text-foreground shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-ring"
        >
          Skip to content
        </a>
        <AppProviders>
          <SiteHeader />
          <main id="main-content" tabIndex={-1} className="flex-1 py-8 focus:outline-none">
            <Container>{children}</Container>
          </main>
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
