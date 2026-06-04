import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
} from "@/app/lib/console-api-client";
import { getUserErrorMessage } from "@/app/lib/user-facing-error";

export type IssueKeyActionState = {
  status: "idle" | "pending" | "success" | "error";
  message: string | null;
};

export type IssueKeyFailureResolution =
  | {
      kind: "redirect";
      message: null;
      shouldRefreshBootstrap: false;
    }
  | {
      kind: "error";
      message: string;
      shouldRefreshBootstrap: boolean;
    };

export type IssueKeyFeedback = {
  tone: "neutral" | "success" | "error";
  title: string;
  message: string;
};

export const idleIssueKeyActionState: IssueKeyActionState = {
  status: "idle",
  message: null,
};

export function resolveIssueKeyFailure(
  error: unknown,
  fallbackMessage: string,
): IssueKeyFailureResolution {
  if (error instanceof ConsoleAuthRedirectError) {
    return {
      kind: "redirect",
      message: null,
      shouldRefreshBootstrap: false,
    };
  }

  if (error instanceof ConsoleHttpError) {
    return {
      kind: "error",
      message: getUserErrorMessage(error, fallbackMessage),
      shouldRefreshBootstrap:
        error.code === "SELF_SERVE_PROVIDER_CONNECTION_NOT_FOUND",
    };
  }

  return {
    kind: "error",
    message: fallbackMessage,
    shouldRefreshBootstrap: false,
  };
}

export function getIssueKeyFeedback(
  locale: string,
  state: IssueKeyActionState,
): IssueKeyFeedback | null {
  const isZh = locale.startsWith("zh");

  if (state.status === "idle") {
    return null;
  }

  if (state.status === "pending") {
    return {
      tone: "neutral",
      title: isZh ? "正在申请个人开发密钥" : "Issuing personal key",
      message: isZh
        ? "正在向当前接入目标签发短期开发凭据。请保持当前页面。"
        : "Issuing a short-lived personal key for the current access target. Keep this page open.",
    };
  }

  if (state.status === "success") {
    return {
      tone: "success",
      title: isZh ? "个人开发密钥已就绪" : "Personal key ready",
      message: isZh
        ? "当前个人开发密钥已显示在下方，并已同步到代码片段。该密钥只会显示在本次会话中。"
        : "The current personal key is shown below and already synced into the snippets. This key is only shown in the current session.",
    };
  }

  return {
    tone: "error",
    title: isZh ? "本次申请未完成" : "Couldn't issue personal key",
    message:
      state.message ??
      (isZh ? "暂时无法签发个人开发密钥，请稍后重试。" : "Couldn't issue a personal key right now. Please retry."),
  };
}
