"use client";

import {useMemo} from "react";

import {messageCatalog} from "@/app/messages";
import {getPathLocale, normalizeLocale} from "@/app/lib/i18n";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";

export default function GlobalError() {
  const locale = useMemo(() => {
    if (typeof window === "undefined") return normalizeLocale();
    return getPathLocale(window.location.pathname);
  }, []);
  const messages = messageCatalog[locale].errors;

  return (
    <html lang={locale}>
      <body className="bg-background text-foreground">
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
          <Card className="w-full max-w-xl">
            <CardContent className="space-y-6 p-8">
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{messages.pageUnavailable}</h1>
              </div>

              <div className="flex gap-3">
                <Button onClick={() => window.location.reload()} type="button">
                  {messages.retry}
                </Button>
                <Button asChild variant="ghost">
                  <a href={locale === "zh" ? "/zh" : "/"}>{messages.openHome}</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </body>
    </html>
  );
}
