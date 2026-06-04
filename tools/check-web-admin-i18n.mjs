import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const issues = [];

const webAdminAppDir = path.join(rootDir, "apps", "web-admin", "app");
const messagesDir = path.join(webAdminAppDir, "messages");

const rawTextGuardPaths = [
  "apps/web-admin/app/page.tsx",
  "apps/web-admin/app/workspaces",
  "apps/web-admin/app/login/page.tsx",
  "apps/web-admin/app/components/action-center.tsx",
  "apps/web-admin/app/components/alert-collaboration-panel.tsx",
  "apps/web-admin/app/components/getting-started-checklist.tsx",
  "apps/web-admin/app/components/report-template-grid.tsx",
  "apps/web-admin/app/components/resource-compact-toolbar.tsx",
];

const legacyMessageParityAllowlist = new Set([
  "audit.json",
]);

const visiblePropNames = [
  "title",
  "description",
  "label",
  "placeholder",
  "subtitle",
  "eyebrow",
  "pendingLabel",
  "confirmLabel",
  "confirmDescription",
  "confirmTitle",
  "aria-label",
  "alt",
];

const allowedTranslateInlineTextPaths = new Set([
  "apps/web-admin/app/alerts/[alertId]/page.tsx",
  "apps/web-admin/app/alerts/alerts-queue-workspace.tsx",
  "apps/web-admin/app/alerts/alerts-queue-workspace.tsx.head",
  "apps/web-admin/app/alerts/collaboration.ts",
  "apps/web-admin/app/alerts/page.tsx",
  "apps/web-admin/app/audit-logs/page.tsx",
  "apps/web-admin/app/auth/select-identity/page.tsx",
  "apps/web-admin/app/budgets/budget-policy-create-form.tsx",
  "apps/web-admin/app/budgets/page.tsx",
  "apps/web-admin/app/components/identity-switcher.tsx",
  "apps/web-admin/app/components/report-template-grid.tsx",
  "apps/web-admin/app/components/setup-summary.ts",
  "apps/web-admin/app/exports/exports-auto-refresh.tsx",
  "apps/web-admin/app/exports/page.tsx",
  "apps/web-admin/app/lib/audit-display.ts",
  "apps/web-admin/app/lib/budget-posture.ts",
  "apps/web-admin/app/lib/i18n-client.tsx",
  "apps/web-admin/app/lib/i18n-server.ts",
  "apps/web-admin/app/lib/i18n.test.ts",
  "apps/web-admin/app/lib/i18n.ts",
  "apps/web-admin/app/lib/resource-scope.ts",
  "apps/web-admin/app/login/page.tsx",
  "apps/web-admin/app/members/member-create-actions.tsx",
  "apps/web-admin/app/members/page.tsx",
  "apps/web-admin/app/organizations/organization-edit-dialog.tsx",
  "apps/web-admin/app/organizations/organizations-create-dialog.tsx",
  "apps/web-admin/app/organizations/page.tsx",
  "apps/web-admin/app/page.tsx",
  "apps/web-admin/app/projects/environment-card.tsx",
  "apps/web-admin/app/projects/page.tsx",
  "apps/web-admin/app/projects/project-card.tsx",
  "apps/web-admin/app/projects/projects-create-actions.tsx",
  "apps/web-admin/app/release-lineage/page.tsx",
  "apps/web-admin/app/setup/page.tsx",
  "apps/web-admin/app/usage-events/[usageEventId]/page.tsx",
  "apps/web-admin/app/usage-events/page.tsx",
  "apps/web-admin/app/virtual-keys/page.tsx",
  "apps/web-admin/app/virtual-keys/virtual-keys-workspace-view.tsx",
]);

const allowedLocaleConditionalPaths = new Set([
  "apps/web-admin/app/[locale]/access/page.tsx",
  "apps/web-admin/app/alerts/[alertId]/page.tsx",
  "apps/web-admin/app/alerts/alerts-queue-workspace.tsx",
  "apps/web-admin/app/alerts/alerts-queue-workspace.tsx.head",
  "apps/web-admin/app/alerts/collaboration.ts",
  "apps/web-admin/app/alerts/page.tsx",
  "apps/web-admin/app/audit-logs/page.tsx",
  "apps/web-admin/app/auth/select-identity/page.tsx",
  "apps/web-admin/app/budgets/budget-policy-create-form.tsx",
  "apps/web-admin/app/budgets/page.tsx",
  "apps/web-admin/app/components/app-shell-support-panels.tsx",
  "apps/web-admin/app/components/getting-started-checklist.tsx",
  "apps/web-admin/app/components/home-formatters.ts",
  "apps/web-admin/app/components/home-global-overview.tsx",
  "apps/web-admin/app/components/home-workspace-overview-summary.tsx",
  "apps/web-admin/app/components/home-workspace-secondary-sections.tsx",
  "apps/web-admin/app/components/identity-switcher.tsx",
  "apps/web-admin/app/exports/exports-auto-refresh.tsx",
  "apps/web-admin/app/exports/page.tsx",
  "apps/web-admin/app/global-error.tsx",
  "apps/web-admin/app/lib/budget-posture.ts",
  "apps/web-admin/app/lib/control-api.ts",
  "apps/web-admin/app/lib/i18n-format.ts",
  "apps/web-admin/app/lib/i18n.ts",
  "apps/web-admin/app/lib/resource-scope.ts",
  "apps/web-admin/app/members/member-create-actions.tsx",
  "apps/web-admin/app/members/page.tsx",
  "apps/web-admin/app/organizations/organization-dropdown.tsx",
  "apps/web-admin/app/organizations/organization-edit-dialog.tsx",
  "apps/web-admin/app/organizations/organizations-create-dialog.tsx",
  "apps/web-admin/app/organizations/page.tsx",
  "apps/web-admin/app/projects/environment-card.tsx",
  "apps/web-admin/app/projects/page.tsx",
  "apps/web-admin/app/projects/project-card.tsx",
  "apps/web-admin/app/projects/projects-create-actions.tsx",
  "apps/web-admin/app/prompt-inspections/page.tsx",
  "apps/web-admin/app/prompt-inspections/policy/page.tsx",
  "apps/web-admin/app/prompt-inspections/prompt-inspection-relationships.ts",
  "apps/web-admin/app/providers/_components/provider-pricing-editor.tsx",
  "apps/web-admin/app/providers/providers-workspace-view.tsx",
  "apps/web-admin/app/usage-events/[usageEventId]/page.tsx",
  "apps/web-admin/app/usage-events/page.tsx",
  "apps/web-admin/app/virtual-keys/page.tsx",
  "apps/web-admin/app/virtual-keys/virtual-keys-workspace-view.tsx",
  "apps/web-admin/app/workspaces/workspaces-page-client.tsx",
  "apps/web-admin/app/workspaces/workspaces-page-state.ts",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLikelyMessageKey(value) {
  return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/u.test(value);
}

function isAllowedLiteral(value) {
  if (!value) return true;
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return true;
  }
  if (isLikelyMessageKey(value)) {
    return true;
  }
  if (/^[A-Z0-9_-]{1,8}$/u.test(value)) {
    return true;
  }
  return false;
}

function shouldReportVisibleText(value) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  if (!/[A-Za-z]/u.test(normalized)) return false;
  if (isAllowedLiteral(normalized)) return false;
  if (/^[A-Z][a-zA-Z0-9]+$/u.test(normalized) && !normalized.includes(" ")) {
    return false;
  }
  return true;
}

function shouldCheckRawText(relativePath) {
  return rawTextGuardPaths.some(
    (includedPath) =>
      relativePath === includedPath || relativePath.startsWith(`${includedPath}${path.sep}`),
  );
}

function compareMessageStructure(enValue, zhValue, scope) {
  const normalizedScope = scope || "<root>";

  if (isPlainObject(enValue) !== isPlainObject(zhValue)) {
    issues.push(`Message structure mismatch at ${normalizedScope}: object shape differs.`);
    return;
  }

  if (Array.isArray(enValue) !== Array.isArray(zhValue)) {
    issues.push(`Message structure mismatch at ${normalizedScope}: array shape differs.`);
    return;
  }

  if (isPlainObject(enValue) && isPlainObject(zhValue)) {
    const enKeys = new Set(Object.keys(enValue));
    const zhKeys = new Set(Object.keys(zhValue));

    for (const key of [...enKeys].sort()) {
      if (!zhKeys.has(key)) {
        issues.push(`Missing zh message key at ${normalizedScope}.${key}`.replace("<root>.", ""));
      }
    }

    for (const key of [...zhKeys].sort()) {
      if (!enKeys.has(key)) {
        issues.push(`Unexpected zh message key at ${normalizedScope}.${key}`.replace("<root>.", ""));
      }
    }

    for (const key of [...enKeys].sort()) {
      if (zhKeys.has(key)) {
        compareMessageStructure(
          enValue[key],
          zhValue[key],
          normalizedScope === "<root>" ? key : `${normalizedScope}.${key}`,
        );
      }
    }

    return;
  }

  const enType = Array.isArray(enValue) ? "array" : typeof enValue;
  const zhType = Array.isArray(zhValue) ? "array" : typeof zhValue;
  if (enType !== zhType) {
    issues.push(`Message structure mismatch at ${normalizedScope}: ${enType} vs ${zhType}.`);
  }
}

async function readJson(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function collectLocaleFiles(locale) {
  const localeDir = path.join(messagesDir, locale);
  const entries = await readdir(localeDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

async function verifyMessageParity() {
  const enFiles = await collectLocaleFiles("en");
  const zhFiles = await collectLocaleFiles("zh");

  const enSet = new Set(enFiles);
  const zhSet = new Set(zhFiles);

  for (const fileName of enFiles) {
    if (!zhSet.has(fileName)) {
      issues.push(`Missing zh message file: ${fileName}`);
    }
  }

  for (const fileName of zhFiles) {
    if (!enSet.has(fileName)) {
      issues.push(`Unexpected zh message file: ${fileName}`);
    }
  }

  for (const fileName of enFiles) {
    if (!zhSet.has(fileName)) {
      continue;
    }

    if (legacyMessageParityAllowlist.has(fileName)) {
      continue;
    }

    const [enJson, zhJson] = await Promise.all([
      readJson(path.join(messagesDir, "en", fileName)),
      readJson(path.join(messagesDir, "zh", fileName)),
    ]);

    compareMessageStructure(enJson, zhJson, fileName.replace(/\.json$/u, ""));
  }
}

async function verifyNoLegacyZhCnMessages() {
  const legacyDir = path.join(messagesDir, "zh-CN");

  try {
    const entries = await readdir(legacyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        issues.push(`Legacy zh-CN message file must be removed: apps/web-admin/app/messages/zh-CN/${entry.name}`);
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function collectRawTextIssues(relativePath, source) {
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    if (
      line.includes("i18n-guard ignore") ||
      line.includes("tr(") ||
      line.includes("t(") ||
      line.includes("translateInlineText(") ||
      line.includes("shellKey(")
    ) {
      continue;
    }

    for (const match of line.matchAll(/>([^<{][^<>]{0,160})</gu)) {
      const candidate = match[1]?.trim() ?? "";
      if (/[{}=?:]/u.test(candidate)) {
        continue;
      }
      if (shouldReportVisibleText(candidate)) {
        issues.push(`${relativePath}:${lineNumber} raw JSX text: ${candidate}`);
      }
    }

    for (const propName of visiblePropNames) {
      const propPattern = new RegExp(`${propName}=(["'])([^"'\\\\]{1,160})\\1`, "gu");
      for (const match of line.matchAll(propPattern)) {
        const candidate = match[2]?.trim() ?? "";
        if (shouldReportVisibleText(candidate)) {
          issues.push(`${relativePath}:${lineNumber} raw ${propName}: ${candidate}`);
        }
      }
    }
  }
}

function checkFileForLanguageAntiPatterns(relativePath, source) {
  const normalizedPath = relativePath.split(path.sep).join("/");

  if (
    /messages\/zh-CN\//u.test(source) ||
    /from\s+["'][^"']*messages\/zh-CN\//u.test(source)
  ) {
    issues.push(`${normalizedPath} references legacy zh-CN message assets.`);
  }

  if (source.includes("translateInlineText(") && !allowedTranslateInlineTextPaths.has(normalizedPath)) {
    issues.push(`${normalizedPath} uses translateInlineText outside the compatibility allowlist.`);
  }

  if (/locale\s*===\s*["']zh["']/u.test(source) && !allowedLocaleConditionalPaths.has(normalizedPath)) {
    issues.push(`${normalizedPath} introduces a locale === "zh" UI branch outside the compatibility allowlist.`);
  }

  if (shouldCheckRawText(normalizedPath)) {
    collectRawTextIssues(normalizedPath, source);
  }
}

async function walkApp(currentDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (entry.isDirectory()) {
      if (entry.name === "messages") {
        continue;
      }

      await walkApp(absolutePath);
      continue;
    }

    if (
      !/\.(?:ts|tsx)$/u.test(entry.name) ||
      entry.name.includes(".test.") ||
      entry.name.includes(".spec.") ||
      entry.name.includes(".bak-")
    ) {
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    checkFileForLanguageAntiPatterns(relativePath, source);
  }
}

await verifyMessageParity();
await verifyNoLegacyZhCnMessages();
await walkApp(webAdminAppDir);

if (issues.length > 0) {
  console.error("Web admin i18n guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Web admin i18n guard passed.");
