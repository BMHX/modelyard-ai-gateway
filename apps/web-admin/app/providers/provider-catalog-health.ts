import type { ProviderConnectionModelCatalog } from "@teamops/contracts";

export type ProviderCatalogCredentialIssue =
  | "credential_unreadable"
  | "credential_key_mismatch";

type ProviderCatalogCredentialIssueCopy = {
  title: string;
  message: string;
};

function copy(locale: string, zh: string, en: string) {
  return locale.startsWith("zh") ? zh : en;
}

export function getProviderCatalogCredentialIssue(
  catalog: ProviderConnectionModelCatalog | null,
): ProviderCatalogCredentialIssue | null {
  if (catalog?.status !== "error") {
    return null;
  }

  if (catalog.errorCode === "credential_unreadable") {
    return "credential_unreadable";
  }

  if (catalog.errorCode === "credential_key_mismatch") {
    return "credential_key_mismatch";
  }

  return null;
}

export function getProviderCatalogCredentialIssueCopy(
  locale: string,
  issue: ProviderCatalogCredentialIssue,
): ProviderCatalogCredentialIssueCopy {
  if (issue === "credential_key_mismatch") {
    return {
      title: copy(
        locale,
        "当前连接的上游密钥需要重新录入",
        "This connection's upstream API key must be re-entered",
      ),
      message: copy(
        locale,
        "当前保存的 Provider API key 是用另一套运行时加密密钥写入的。请先在下方重新填写 API key，再保存并重试读取目录。",
        "The saved provider API key was written with a different runtime encryption key. Re-enter the API key below, then save and retry the catalog.",
      ),
    };
  }

  return {
    title: copy(
      locale,
      "当前连接的上游密钥不可读",
      "This connection's upstream API key is unreadable",
    ),
    message: copy(
      locale,
      "当前保存的 Provider API key 无法被系统读取。请先在下方重新填写 API key，再保存并重试读取目录。",
      "The saved provider API key could not be read. Re-enter the API key below, then save and retry the catalog.",
    ),
  };
}
