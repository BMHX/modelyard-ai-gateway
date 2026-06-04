import { Link } from "@/i18n/navigation";

import {getT} from "@/app/lib/i18n-server";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";

export default async function NotFound() {
  const t = await getT("errors");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-xl">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">404</p>
            <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-foreground">{t("notFoundTitle")}</h1>
            <p className="text-[13px] leading-5 text-muted-foreground">{t("notFoundDescription")}</p>
          </div>

          <div>
            <Button asChild>
              <Link href="/">{t("openHome")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
