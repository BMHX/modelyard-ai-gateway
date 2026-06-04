import type { FastifyReply } from "fastify";

import type { ApiErrorCode } from "@teamops/contracts";

type ApiErrorDetails = Record<string, unknown> | undefined;

export function buildApiError(args: {
  code: ApiErrorCode;
  message: string;
  resource?: string;
  details?: ApiErrorDetails;
}) {
  return {
    error: {
      code: args.code,
      message: args.message,
      ...(args.resource ? { resource: args.resource } : {}),
      ...(args.details ? { details: args.details } : {}),
    },
  };
}

export function sendApiError(
  reply: FastifyReply,
  args: {
    statusCode: number;
    code: ApiErrorCode;
    message: string;
    resource?: string;
    details?: ApiErrorDetails;
  },
) {
  reply.code(args.statusCode);
  return buildApiError(args);
}
