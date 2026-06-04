"use client";

import type {ReactNode} from "react";
import {useState} from "react";
import {QueryClientProvider} from "@tanstack/react-query";
import {NextIntlClientProvider} from "next-intl";
import { Toaster } from "sonner";

import {createConsoleQueryClient} from "@/app/lib/console-api-client";
import {type AppLocale} from "@/app/lib/i18n";
import {LocalePreferenceProvider} from "@/app/lib/i18n-client";
import {CapabilityProvider} from "@/app/components/capability-provider";

import {ThemeProvider} from "./theme-provider";

const defaultTimeZone = "UTC";

export function AppProviders({
  children,
  locale,
  messages,
}: {
  children: ReactNode;
  locale: AppLocale;
  messages: Record<string, unknown>;
}) {
  const [queryClient] = useState(() => createConsoleQueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem storageKey="teamops-admin-theme">
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={defaultTimeZone}>
          <LocalePreferenceProvider>
            <CapabilityProvider>
              {children}
              <Toaster closeButton position="top-right" richColors />
            </CapabilityProvider>
          </LocalePreferenceProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
