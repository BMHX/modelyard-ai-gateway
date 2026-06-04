type ModelCatalogErrorCopy = {
  inlineMessage: string;
  title: string;
  description: string;
  providersCtaLabel: string;
};

function tr(isZh: boolean, zh: string, en: string) {
  return isZh ? zh : en;
}

export function getModelCatalogErrorCopy(args: {
  locale: string;
  errorCode: string | null;
  fallbackMessage: string;
}): ModelCatalogErrorCopy {
  const isZh = args.locale.startsWith("zh");

  if (args.errorCode === "SELF_SERVE_PROVIDER_CONNECTION_PLACEHOLDER_CREDENTIAL") {
    return {
      inlineMessage: tr(
        isZh,
        "该接入目标未配置真实上游密钥。请前往 Providers 更新该连接后再读取模型目录。",
        "This access target does not have a real upstream API key configured. Update the connection in Providers before reading the model catalog.",
      ),
      title: tr(
        isZh,
        "该接入目标未配置真实上游密钥",
        "This access target is missing a real upstream API key",
      ),
      description: tr(
        isZh,
        "当前所选连接仍在使用占位凭据，无法读取 /v1/models。请先到 Providers 更新真实 Provider API key，再回到这里重试。",
        "The selected connection is still using a placeholder credential and cannot read /v1/models. Update the real provider API key in Providers, then retry here.",
      ),
      providersCtaLabel: tr(isZh, "去更新 Providers", "Update Providers"),
    };
  }

  if (args.errorCode === "SELF_SERVE_PROVIDER_CONNECTION_CREDENTIAL_UNREADABLE") {
    return {
      inlineMessage: tr(
        isZh,
        "该接入目标保存的上游密钥当前无法解密。请前往 Providers 重新填写该连接的 API key 后重试。",
        "The stored upstream API key for this access target cannot be decrypted right now. Re-enter the connection API key in Providers, then retry.",
      ),
      title: tr(
        isZh,
        "该接入目标的上游密钥不可读",
        "This access target's upstream API key is unreadable",
      ),
      description: tr(
        isZh,
        "当前连接保存的 Provider API key 无法被系统读取，所以无法读取 /v1/models。请到 Providers 重新填写该连接的真实 API key，再回到这里重试。",
        "The stored provider API key for this connection could not be read, so /v1/models cannot be loaded. Re-enter the real provider API key in Providers, then retry here.",
      ),
      providersCtaLabel: tr(isZh, "去重新填写密钥", "Re-enter API key"),
    };
  }

  if (args.errorCode === "SELF_SERVE_PROVIDER_CONNECTION_CREDENTIAL_KEY_MISMATCH") {
    return {
      inlineMessage: tr(
        isZh,
        "该接入目标保存的上游密钥与当前运行环境的加密密钥不匹配。请前往 Providers 重新填写该连接的 API key 后重试。",
        "The stored upstream API key for this access target was encrypted with a different runtime key. Re-enter the connection API key in Providers, then retry.",
      ),
      title: tr(
        isZh,
        "该接入目标的上游密钥需要重新录入",
        "This access target's upstream API key must be re-entered",
      ),
      description: tr(
        isZh,
        "当前连接保存的 Provider API key 不是用当前环境的加密密钥保存的，因此无法读取 /v1/models。请到 Providers 重新填写真实 API key，再回到这里重试。",
        "The stored provider API key for this connection was not saved with the current runtime key, so /v1/models cannot be loaded. Re-enter the real provider API key in Providers, then retry here.",
      ),
      providersCtaLabel: tr(isZh, "去重新填写密钥", "Re-enter API key"),
    };
  }

  return {
    inlineMessage: args.fallbackMessage,
    title: tr(isZh, "模型目录暂时不可用", "Model catalog unavailable"),
    description: tr(
      isZh,
      "无法读取所选接入目标的 /v1/models 结果。请重试，或先到 Providers 检查该连接的上游状态。",
      "The selected access target's /v1/models result could not be read. Retry, or inspect the upstream health in Providers first.",
    ),
    providersCtaLabel: tr(isZh, "打开 Providers", "Open Providers"),
  };
}
