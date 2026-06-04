"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { AuthIdentityOptionSchema, type AuthIdentityOption } from "@/app/lib/auth-identities";
import { usePathLocale } from "@/app/lib/i18n-client";
import { translateInlineText, type AppLocale } from "@/app/lib/i18n";
import { Button } from "@/components/ui/button";
import { getVisibleIdentityRoleOptions } from "@/app/components/identity-switcher-state";

function formatInlineText(locale: AppLocale, text: string) {
  return locale === "zh" ? translateInlineText(locale, text) : text;
}

function formatRoleLabel(role: string, locale: AppLocale) {
  if (role === "developer") {
    return formatInlineText(locale, "Developer");
  }

  return formatInlineText(locale, "Admin");
}

export default function SelectIdentityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = usePathLocale();
  const [identities, setIdentities] = useState<AuthIdentityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const returnTo = searchParams?.get("returnTo") || "/";
  const visibleRoleOptions = getVisibleIdentityRoleOptions({
    identities,
    currentWorkspaceId: null,
  });

  useEffect(() => {
    async function fetchIdentities() {
      try {
        const response = await fetch("/api/auth/session/identities");

        if (!response.ok) {
          throw new Error("Failed to fetch available identities");
        }

        const data = await response.json();
        const parsed = z.array(AuthIdentityOptionSchema).parse(data);
        setIdentities(parsed);

        const roleOptions = getVisibleIdentityRoleOptions({
          identities: parsed,
          currentWorkspaceId: null,
        });

        if (roleOptions.length === 1 && roleOptions[0]) {
          handleSelect(roleOptions[0].identity, roleOptions[0].role);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      } finally {
        setLoading(false);
      }
    }

    fetchIdentities();
  }, []);

  async function handleSelect(identity: AuthIdentityOption, role: string) {
    const selectionKey = `${identity.membershipId}:${role}`;
    setSelecting(selectionKey);

    try {
      const response = await fetch("/api/auth/session/active-identity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          membershipId: identity.membershipId,
          role,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to select identity");
      }

      router.push(returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select identity");
      setSelecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-canvas">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">{formatInlineText(locale, "Loading identities...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-canvas p-6">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border bg-surface-1 p-8 shadow-none">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {formatInlineText(locale, "Choose your identity")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatInlineText(locale, "Select the workspace and role you want to use for this session.")}
          </p>
        </div>

        {error ? (
          <div className="rounded-lg bg-critical/10 p-4 text-sm text-critical">{error}</div>
        ) : null}

        <div className="grid gap-3">
          {visibleRoleOptions.map(({ identity, role }) => {
            const selectionKey = `${identity.membershipId}:${role}`;
            const isSelecting = selecting === selectionKey;

            return (
              <button
                key={selectionKey}
                onClick={() => handleSelect(identity, role)}
                disabled={Boolean(selecting)}
                className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-surface-2 px-5 py-4 text-left transition-all hover:border-primary/50 hover:bg-surface-selected focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              >
                <div className="space-y-1">
                  <div className="font-medium text-foreground">{identity.workspaceName}</div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {formatRoleLabel(role, locale)}
                  </div>
                </div>
                {isSelecting ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="text-center">
          <Button variant="ghost" className="text-muted-foreground" onClick={() => router.push("/login")}>
            {formatInlineText(locale, "Cancel and return to login")}
          </Button>
        </div>
      </div>
    </div>
  );
}
