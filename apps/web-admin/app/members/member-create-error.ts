import type { AppLocale } from "../lib/i18n";

type ValidationIssue = {
  code?: string;
  exact?: boolean;
  inclusive?: boolean;
  maximum?: number;
  message?: string;
  minimum?: number;
  path?: unknown[];
  received?: string;
  type?: string;
  validation?: string;
};

function getLocalizedFieldLabel(locale: AppLocale, field: string | null) {
  if (locale === "zh") {
    switch (field) {
      case "name":
        return "名称";
      case "email":
        return "邮箱";
      case "temporaryAccessExpiresAt":
        return "临时访问结束时间";
      default:
        return "该字段";
    }
  }

  switch (field) {
    case "name":
      return "Name";
    case "email":
      return "Email";
    case "temporaryAccessExpiresAt":
      return "Temporary access end time";
    default:
      return "This field";
  }
}

function getIssueField(issue: ValidationIssue) {
  if (!Array.isArray(issue.path)) {
    return null;
  }

  for (let index = issue.path.length - 1; index >= 0; index -= 1) {
    const segment = issue.path[index];
    if (typeof segment === "string") {
      return segment;
    }
  }

  return null;
}

function parseValidationIssues(rawMessage: string): ValidationIssue[] | null {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return null;
  }

  const bracketStart = trimmed.indexOf("[");
  const bracketEnd = trimmed.lastIndexOf("]");
  if (bracketStart < 0 || bracketEnd <= bracketStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(bracketStart, bracketEnd + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((issue): issue is ValidationIssue => Boolean(issue) && typeof issue === "object");
  } catch {
    return null;
  }
}

function formatValidationIssue(locale: AppLocale, issue: ValidationIssue) {
  const field = getIssueField(issue);
  const fieldLabel = getLocalizedFieldLabel(locale, field);
  const rawMessage = issue.message?.trim() ?? "";

  if (
    issue.code === "invalid_type" &&
    (issue.received === "undefined" || issue.received === "null")
  ) {
    return locale === "zh" ? `请填写${fieldLabel}。` : `Please enter ${fieldLabel.toLowerCase()}.`;
  }

  if (
    issue.code === "too_small" &&
    issue.type === "string" &&
    typeof issue.minimum === "number"
  ) {
    if (issue.minimum <= 1) {
      return locale === "zh" ? `请填写${fieldLabel}。` : `Please enter ${fieldLabel.toLowerCase()}.`;
    }

    return locale === "zh"
      ? `${fieldLabel}至少填写 ${issue.minimum} 个字符。`
      : `${fieldLabel} must contain at least ${issue.minimum} characters.`;
  }

  if (
    issue.code === "too_big" &&
    issue.type === "string" &&
    typeof issue.maximum === "number"
  ) {
    return locale === "zh"
      ? `${fieldLabel}不能超过 ${issue.maximum} 个字符。`
      : `${fieldLabel} must be ${issue.maximum} characters or less.`;
  }

  if (
    issue.code === "invalid_string" &&
    (issue.validation === "email" || /valid email/i.test(rawMessage))
  ) {
    return locale === "zh" ? "请输入有效的邮箱地址。" : "Please enter a valid email address.";
  }

  if (
    issue.code === "invalid_string" &&
    (issue.validation === "datetime" || /valid date ?time|valid datetime/i.test(rawMessage))
  ) {
    return locale === "zh" ? "请输入有效的时间。" : "Please enter a valid time.";
  }

  if (/String must contain at least (\d+) character\(s\)/i.test(rawMessage)) {
    const minimum = Number(rawMessage.match(/String must contain at least (\d+) character\(s\)/i)?.[1] ?? 0);
    if (minimum > 1) {
      return locale === "zh"
        ? `${fieldLabel}至少填写 ${minimum} 个字符。`
        : `${fieldLabel} must contain at least ${minimum} characters.`;
    }

    return locale === "zh" ? `请填写${fieldLabel}。` : `Please enter ${fieldLabel.toLowerCase()}.`;
  }

  if (/Invalid email/i.test(rawMessage)) {
    return locale === "zh" ? "请输入有效的邮箱地址。" : "Please enter a valid email address.";
  }

  if (/Invalid datetime|Invalid date ?time/i.test(rawMessage)) {
    return locale === "zh" ? "请输入有效的时间。" : "Please enter a valid time.";
  }

  return null;
}

function localizeKnownMessage(locale: AppLocale, rawMessage: string) {
  if (locale !== "zh") {
    return rawMessage;
  }

  const exactMatches: Record<string, string> = {
    "Can't connect right now. Please try again.": "当前无法连接，请稍后重试。",
    "Can't save this member right now.": "当前无法保存成员，请稍后重试。",
    "No permission is assigned to this account": "当前账号未分配任何角色，无法登录控制台。",
    "No permission is assigned to this membership": "该成员当前未分配任何角色，暂无任何权限。",
    "Please enter a valid email address.": "请输入有效的邮箱地址。",
    "Please enter a valid time.": "请输入有效的时间。",
    "Please enter something to save.": "请先填写后再保存。",
    "The selected item is no longer available.": "所选内容已不可用。",
    "This name is already in use.": "该名称已被占用。",
    "You don't have permission to do this.": "你没有权限执行此操作。",
  };

  if (exactMatches[rawMessage]) {
    return exactMatches[rawMessage];
  }

  const enterFieldMatch = rawMessage.match(/^Please enter (.+)\.$/i);
  if (enterFieldMatch) {
    const fieldPhrase = enterFieldMatch[1]?.trim().toLowerCase() ?? "";
    if (fieldPhrase === "name") {
      return "请输入名称。";
    }
    if (fieldPhrase === "email") {
      return "请输入邮箱。";
    }
    if (fieldPhrase === "temporary access end time") {
      return "请输入临时访问结束时间。";
    }
  }

  const minMatch = rawMessage.match(/^Name must contain at least (\d+) characters\.$/i);
  if (minMatch) {
    return `名称至少填写 ${minMatch[1]} 个字符。`;
  }

  const maxMatch = rawMessage.match(/^Name must be (\d+) characters or less\.$/i);
  if (maxMatch) {
    return `名称不能超过 ${maxMatch[1]} 个字符。`;
  }

  if (/at least one role is required/i.test(rawMessage)) {
    return "请至少选择一个角色。";
  }

  return rawMessage;
}

export function formatMemberCreateErrorMessage(
  locale: AppLocale,
  rawMessage: string | null | undefined,
) {
  const normalizedMessage = rawMessage?.trim();
  if (!normalizedMessage) {
    return locale === "zh" ? "当前无法保存成员，请稍后重试。" : "Can't save this member right now.";
  }

  const issues = parseValidationIssues(normalizedMessage);
  if (issues?.length) {
    return formatValidationIssue(locale, issues[0] ?? {}) ?? localizeKnownMessage(locale, normalizedMessage);
  }

  return localizeKnownMessage(locale, normalizedMessage);
}
