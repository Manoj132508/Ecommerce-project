import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { publicEnv } from "@/lib/env/public";
import { AppProviders } from "@/providers/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: publicEnv.appName, template: `%s · ${publicEnv.appName}` },
  description: "Online store",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppProviders>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
