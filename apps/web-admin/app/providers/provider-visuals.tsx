import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

import type { ProviderConnection } from "@teamops/contracts";

import type { ProviderConnectionFormInput } from "./actions";

export type ProviderVisualTone =
  | "violet"
  | "emerald"
  | "sky"
  | "amber"
  | "rose"
  | "stone"
  | "slate";

export type ProviderVisualMeta = {
  providerKey: string;
  label: string;
  glyph: string;
  tone: ProviderVisualTone;
  shortHelper: string;
  logoSrc?: string;
};

export type ProviderTemplateVisualKey =
  | "anthropic"
  | "openai"
  | "private-cluster"
  | "qwen"
  | "deepseek"
  | "internal"
  | "customer-gateway"
  | "bedrock"
  | "vertex";

const providerVisualRegistry: Record<ProviderTemplateVisualKey, ProviderVisualMeta> = {
  anthropic: {
    providerKey: "anthropic",
    label: "Anthropic",
    glyph: "A",
    tone: "violet",
    shortHelper: "Claude routes",
    logoSrc: "/provider-logos/anthropic.png",
  },
  openai: {
    providerKey: "openai",
    label: "OpenAI",
    glyph: "O",
    tone: "emerald",
    shortHelper: "GPT routes",
    logoSrc: "/provider-logos/openai.png",
  },
  "private-cluster": {
    providerKey: "private-cluster",
    label: "Private cluster",
    glyph: "P",
    tone: "sky",
    shortHelper: "Custom / self-hosted",
    logoSrc: "/provider-logos/private-cluster.svg",
  },
  qwen: {
    providerKey: "qwen",
    label: "Qwen",
    glyph: "Q",
    tone: "amber",
    shortHelper: "Qwen-prefixed routes",
    logoSrc: "/provider-logos/qwen.ico",
  },
  deepseek: {
    providerKey: "deepseek",
    label: "DeepSeek",
    glyph: "D",
    tone: "rose",
    shortHelper: "DeepSeek-prefixed routes",
    logoSrc: "/provider-logos/deepseek.ico",
  },
  internal: {
    providerKey: "internal",
    label: "Internal endpoint",
    glyph: "I",
    tone: "stone",
    shortHelper: "Proxy / gateway lane",
    logoSrc: "/provider-logos/internal-endpoint.svg",
  },
  "customer-gateway": {
    providerKey: "customer-gateway",
    label: "Customer gateway",
    glyph: "C",
    tone: "slate",
    shortHelper: "Customer-owned OpenAI edge",
    logoSrc: "/provider-logos/customer-gateway.svg",
  },
  bedrock: {
    providerKey: "bedrock",
    label: "Bedrock",
    glyph: "B",
    tone: "amber",
    shortHelper: "AWS model access",
    logoSrc: "/provider-logos/aws.ico",
  },
  vertex: {
    providerKey: "vertex",
    label: "Vertex",
    glyph: "V",
    tone: "sky",
    shortHelper: "Google model access",
    logoSrc: "/provider-logos/google-cloud.ico",
  },
};

const toneClassNameMap: Record<ProviderVisualTone, string> = {
  violet:
    "border-violet-200/80 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200",
  emerald:
    "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  sky:
    "border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-200",
  amber:
    "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100",
  rose:
    "border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200",
  stone:
    "border-stone-200/90 bg-stone-50 text-stone-700 dark:border-stone-400/30 dark:bg-stone-500/15 dark:text-stone-200",
  slate:
    "border-slate-200/90 bg-slate-100 text-slate-700 dark:border-slate-400/30 dark:bg-slate-500/15 dark:text-slate-200",
};

function ProviderLogo({
  providerKey,
  className,
}: {
  providerKey: ProviderVisualMeta["providerKey"];
  className?: string;
}) {
  const sharedClassName = cn("size-full", className);

  if (providerKey === "anthropic") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M12 4 5.5 20h3.2l1.45-3.7h3.72L15.3 20h3.2L12 4Zm-.02 5.22 1.42 3.83h-2.86l1.44-3.83Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "openai") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "qwen") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M12 4a8 8 0 1 0 5.07 14.18l2.08 2.08 1.41-1.41-2.07-2.08A8 8 0 0 0 12 4Zm0 2.4A5.6 5.6 0 1 1 6.4 12 5.61 5.61 0 0 1 12 6.4Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "deepseek") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M7 4h6.2A6.8 6.8 0 0 1 13.2 20H7V4Zm2.6 2.5v11h3.36a4.3 4.3 0 1 0 0-8.6H9.6Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "bedrock") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M6 4h7.2a3.6 3.6 0 0 1 0 7.2H6V4Zm2.6 2.4v2.4h4.14a1.2 1.2 0 1 0 0-2.4H8.6ZM6 12.4h7.65a3.8 3.8 0 1 1 0 7.6H6v-7.6Zm2.6 2.4v2.8h4.59a1.4 1.4 0 1 0 0-2.8H8.6Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "vertex") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M4.8 6.2 7 5l5 8.2L17 5l2.2 1.2L12 19 4.8 6.2Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (providerKey === "private-cluster") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M8 6.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm8 0a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM12 12.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM9.7 10.8l2.6 2.1m1.1-2.1-2.6 2.1m-4.5-.6 3.1 2.5m8.3-2.5-3.1 2.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (providerKey === "internal") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M5 6.5h14v11H5v-11Zm3 2.7h8m-8 3h5m3.8 2.4H8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (providerKey === "customer-gateway") {
    return (
      <svg aria-hidden="true" className={sharedClassName} fill="none" viewBox="0 0 24 24">
        <path
          d="M12 4 5 7.2v4.8c0 4.2 2.98 6.82 7 8 4.02-1.18 7-3.8 7-8V7.2L12 4Zm0 3 4.5 2.05V12c0 2.68-1.8 4.68-4.5 5.6-2.7-.92-4.5-2.92-4.5-5.6V9.05L12 7Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return null;
}

function getProviderLogoNode(meta: ProviderVisualMeta): ReactNode {
  if (meta.logoSrc) {
    return (
      <img
        alt=""
        className="size-full object-contain"
        draggable="false"
        src={meta.logoSrc}
      />
    );
  }

  const logo = <ProviderLogo providerKey={meta.providerKey} />;
  if (logo) {
    return logo;
  }

  return meta.glyph;
}

function normalizeConnectionText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function getProviderVisualMetaByTemplateKey(
  key: ProviderTemplateVisualKey,
): ProviderVisualMeta {
  return providerVisualRegistry[key];
}

export function getProviderVisualMetaByProvider(
  provider: ProviderConnectionFormInput["provider"] | ProviderConnection["provider"],
): ProviderVisualMeta {
  if (provider === "anthropic") {
    return providerVisualRegistry.anthropic;
  }

  if (provider === "openai") {
    return providerVisualRegistry.openai;
  }

  if (provider === "bedrock") {
    return providerVisualRegistry.bedrock;
  }

  if (provider === "vertex") {
    return providerVisualRegistry.vertex;
  }

  return providerVisualRegistry["private-cluster"];
}

export function getProviderVisualMetaForConnection(
  connection: ProviderConnection,
): ProviderVisualMeta {
  if (connection.provider === "anthropic" || connection.provider === "openai") {
    return getProviderVisualMetaByProvider(connection.provider);
  }

  if (connection.provider === "bedrock" || connection.provider === "vertex") {
    return getProviderVisualMetaByProvider(connection.provider);
  }

  const label = normalizeConnectionText(connection.label);
  const baseUrl = normalizeConnectionText(connection.baseUrl);
  const prefixes = [
    normalizeConnectionText(connection.metadata.modelPrefixes),
    normalizeConnectionText(connection.metadata.defaultModelPrefixes),
    normalizeConnectionText(connection.metadata["routing.modelPrefixes"]),
  ].join(" ");

  if (label.includes("qwen") || baseUrl.includes("qwen") || prefixes.includes("qwen-")) {
    return providerVisualRegistry.qwen;
  }

  if (
    label.includes("deepseek") ||
    baseUrl.includes("deepseek") ||
    prefixes.includes("deepseek-")
  ) {
    return providerVisualRegistry.deepseek;
  }

  if (label.includes("internal") || label.includes("gateway") || baseUrl.includes("internal")) {
    return providerVisualRegistry.internal;
  }

  if (label.includes("customer") || baseUrl.includes("customer")) {
    return providerVisualRegistry["customer-gateway"];
  }

  return providerVisualRegistry["private-cluster"];
}

export function ProviderAvatar({
  meta,
  size = "md",
  className,
}: {
  meta: ProviderVisualMeta;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClassName =
    size === "sm"
      ? "size-7 text-[11px]"
      : size === "lg"
        ? "size-11 text-sm"
        : "size-9 text-[12px]";
  const logoSizeClassName =
    size === "sm"
      ? "[&_svg]:size-4 [&_img]:size-4"
      : size === "lg"
        ? "[&_svg]:size-6 [&_img]:size-6"
        : "[&_svg]:size-5 [&_img]:size-5";
  const baseClassName = meta.providerKey === "openai"
    ? "border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,white_4%)] text-[color:var(--foreground)] dark:text-white"
    : meta.logoSrc
    ? "border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,white_4%)] text-foreground"
    : toneClassNameMap[meta.tone];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl border font-semibold tracking-[0.01em] shadow-none",
        sizeClassName,
        logoSizeClassName,
        baseClassName,
        className,
      )}
    >
      {getProviderLogoNode(meta)}
    </span>
  );
}
