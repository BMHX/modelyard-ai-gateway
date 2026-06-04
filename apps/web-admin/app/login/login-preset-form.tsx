"use client";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useT } from "../lib/i18n-client";

type LoginPreset = {
  id: string;
  label: string;
  helper: string;
  email: string;
  organizationSlug: string;
};

type LoginPresetFormProps = {
  defaultOrganizationSlug: string;
  errorMessage: string;
  errorCode: string;
  errorStage: string;
  requestId: string;
  correlationId: string;
  returnTo: string;
  showTestLoginActions: boolean;
};

function getLoginPresets(t: (key: string) => string): LoginPreset[] {
  return [
    {
      id: "alice-admin",
      label: t("presetItems.aliceAdmin.label"),
      helper: t("presetItems.aliceAdmin.helper"),
      email: "alice@example.com",
      organizationSlug: "pilot-demo-org",
    },
    {
      id: "bob-developer",
      label: t("presetItems.bobDeveloper.label"),
      helper: t("presetItems.bobDeveloper.helper"),
      email: "bob@example.com",
      organizationSlug: "pilot-demo-org",
    },
  ];
}

export function LoginPresetForm({
  defaultOrganizationSlug,
  errorMessage,
  errorCode,
  errorStage,
  requestId,
  correlationId,
  returnTo,
  showTestLoginActions,
}: LoginPresetFormProps) {
  const t = useT("login");
  const presets = useMemo(() => getLoginPresets(t), [t]);
  const [organizationSlug, setOrganizationSlug] = useState(
    defaultOrganizationSlug,
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const errorHint =
    errorStage === "oidc_callback"
      ? t("errors.callbackHint")
      : errorStage === "oidc_start"
        ? t("errors.startHint")
        : "";
  const surfaceClass = "border-border/60 bg-muted/40 hover:bg-muted/60";
  const activeSurfaceClass =
    "border-primary/50 bg-primary/5 shadow-none ring-1 ring-primary/20";
  const secondaryButtonClass =
    "border-border/60 bg-background text-foreground shadow-none hover:bg-muted hover:text-foreground transition-all";
  const primaryButtonClass =
    "bg-foreground text-background shadow-none hover:bg-foreground/92 transition-all";

  function fillPreset(preset: LoginPreset) {
    if (isSubmitting) {
      return;
    }

    setSelectedPresetId(preset.id);
    setOrganizationSlug(preset.organizationSlug);
  }

  function submitTestLogin(preset: LoginPreset) {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/test-login";

    const fields = {
      org: preset.organizationSlug,
      email: preset.email,
      returnTo,
    };

    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  }

  function handleOidcSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (showTestLoginActions && selectedPreset) {
      setIsSubmitting(true);
      submitTestLogin(selectedPreset);
      return;
    }

    const trimmedOrganizationSlug = organizationSlug.trim();
    if (!trimmedOrganizationSlug) {
      const input = event.currentTarget.elements.namedItem("org");
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.reportValidity();
      }
      return;
    }

    setIsSubmitting(true);
    const searchParams = new URLSearchParams({
      org: trimmedOrganizationSlug,
      returnTo,
    });
    window.location.assign(`/auth/start?${searchParams.toString()}`);
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="space-y-2.5">
        <div className="space-y-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t("presets.title")}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {showTestLoginActions
              ? t("presets.description.development")
              : t("presets.description.oidc")}
          </p>
        </div>
        <div className="grid gap-2">
          {presets.map((preset) => {
            const isActive = selectedPreset?.id === preset.id;

            return (
              <div
                className={`rounded-xl border px-3 py-3 transition-colors ${
                  isActive ? activeSurfaceClass : surfaceClass
                }`}
                key={preset.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="min-w-0 flex-1 rounded-lg text-left outline-none transition-opacity hover:opacity-90"
                    disabled={isSubmitting}
                    onClick={() => fillPreset(preset)}
                    type="button"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {preset.label}
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {preset.helper}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {preset.organizationSlug}
                    </p>
                  </button>
                  {showTestLoginActions ? (
                    <form
                      action="/auth/test-login"
                      className="shrink-0"
                      method="post"
                    >
                      <input
                        name="org"
                        type="hidden"
                        value={preset.organizationSlug}
                      />
                      <input name="email" type="hidden" value={preset.email} />
                      <input name="returnTo" type="hidden" value={returnTo} />
                      <Button
                        className={secondaryButtonClass}
                        disabled={isSubmitting}
                        size="sm"
                        type="submit"
                        variant="outline"
                      >
                        {t("presets.directSignIn")}
                      </Button>
                    </form>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground ${surfaceClass}`}
                    >
                      {preset.organizationSlug}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {selectedPreset ? (
          <p
            className={`rounded-xl border px-3 py-2 text-sm leading-6 text-muted-foreground ${surfaceClass}`}
          >
            {t("presets.accountLabel")}:{" "}
            <span className="font-medium text-foreground">
              {selectedPreset.email}
            </span>
          </p>
        ) : null}
        {showTestLoginActions ? (
          <p
            className={`rounded-xl border px-3 py-2 text-xs leading-5 text-muted-foreground ${surfaceClass}`}
          >
            {t("presets.directSignInNotice")}
          </p>
        ) : null}
      </div>
      <form
        action="/auth/start"
        className="space-y-4"
        method="get"
        onSubmit={handleOidcSubmit}
      >
        <input name="returnTo" type="hidden" value={returnTo} />
        <div className="space-y-2">
          <label
            className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            htmlFor="org"
          >
            {t("fields.organizationSlug")}
          </label>
          <Input
            autoCapitalize="off"
            autoComplete="organization"
            autoCorrect="off"
            disabled={isSubmitting}
            id="org"
            name="org"
            onChange={(event) => {
              setOrganizationSlug(event.target.value);
              if (
                selectedPreset &&
                event.target.value !== selectedPreset.organizationSlug
              ) {
                setSelectedPresetId(null);
              }
            }}
            placeholder="pilot-demo-org"
            required
            value={organizationSlug}
          />
        </div>
        {errorMessage ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">
            <p>{errorMessage}</p>
            {errorHint ? (
              <p className="mt-1 text-xs leading-5 text-destructive/80">{errorHint}</p>
            ) : null}
            {errorCode || requestId || correlationId ? (
              <div className="mt-2 space-y-1 text-[11px] leading-5 text-destructive/80">
                {errorCode ? (
                  <p>
                    {t("errors.codeLabel")}:{" "}
                    <span className="font-mono text-destructive">{errorCode}</span>
                  </p>
                ) : null}
                {requestId ? (
                  <p>
                    {t("errors.requestIdLabel")}:{" "}
                    <span className="font-mono text-destructive">{requestId}</span>
                  </p>
                ) : null}
                {correlationId ? (
                  <p>
                    {t("errors.correlationIdLabel")}:{" "}
                    <span className="font-mono text-destructive">{correlationId}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <Button
          aria-busy={isSubmitting}
          className={`w-full ${primaryButtonClass}`}
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? t("actions.continueOidcPending")
            : showTestLoginActions && selectedPreset
              ? t("presets.directSignIn")
              : showTestLoginActions
                ? t("actions.continueConfiguredOidc")
                : t("actions.continueOidc")}
        </Button>
      </form>
    </div>
  );
}
