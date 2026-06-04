import { ShieldCheck } from "lucide-react";

import { getCurrentLocale, getT } from "../lib/i18n-server";
import { stripLocalePrefix } from "../lib/i18n";
import { getSafeReturnTo } from "../lib/navigation";
import { resolveLoginErrorMessage } from "./login-error";
import { LoginPresetForm } from "./login-preset-form";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    org?: string;
    returnTo?: string;
    error?: string;
    errorCode?: string;
    errorStage?: string;
    requestId?: string;
    correlationId?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const t = await getT("login");
  const locale = await getCurrentLocale();
  const showTestLoginActions = process.env.NODE_ENV !== "production";
  const resolvedSearchParams = (await searchParams) ?? {};
  const organizationSlug = resolvedSearchParams.org?.trim() ?? "";
  const safeReturnTo = getSafeReturnTo(resolvedSearchParams.returnTo);
  const normalizedReturnToPath = safeReturnTo ? stripLocalePrefix(safeReturnTo.split("?")[0] ?? safeReturnTo) : null;
  const returnTo =
    normalizedReturnToPath === "/login" || normalizedReturnToPath?.startsWith("/auth/")
      ? "/"
      : safeReturnTo ?? "/";
  const errorMessage = resolvedSearchParams.error?.trim() ?? "";
  const errorCode = resolvedSearchParams.errorCode?.trim() ?? "";
  const errorStage = resolvedSearchParams.errorStage?.trim() ?? "";
  const requestId = resolvedSearchParams.requestId?.trim() ?? "";
  const correlationId = resolvedSearchParams.correlationId?.trim() ?? "";
  const localizedErrorMessage = resolveLoginErrorMessage({
    locale,
    errorCode,
    errorMessage,
  });
  const loginDescription = showTestLoginActions
    ? t("description.development")
    : t("description.oidc");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:color-mix(in_srgb,var(--surface-canvas)_88%,white_12%)] px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-none sm:p-8">
        <div className="space-y-4">
          <div className="inline-flex size-11 items-center justify-center rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] text-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[1.65rem] font-semibold tracking-[-0.03em] text-foreground">
              {t("title")}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {loginDescription}
            </p>
          </div>
        </div>

        <LoginPresetForm
          defaultOrganizationSlug={organizationSlug}
          errorMessage={localizedErrorMessage}
          errorCode={errorCode}
          errorStage={errorStage}
          requestId={requestId}
          correlationId={correlationId}
          returnTo={returnTo}
          showTestLoginActions={showTestLoginActions}
        />
      </section>
    </main>
  );
}
