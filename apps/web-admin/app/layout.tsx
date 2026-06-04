import type {Metadata} from "next";
import {type ReactNode} from "react";

import {PersistentAppShell} from "@/app/components/app-shell";
import {getCurrentLocale, getT} from "@/app/lib/i18n-server";
import {AppProviders} from "@/components/app-providers";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("layout");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({children}: {children: ReactNode}) {
  const locale = await getCurrentLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <AppProviders locale={locale} messages={{}}>
          <PersistentAppShell>{children}</PersistentAppShell>
        </AppProviders>
      </body>
    </html>
  );
}
