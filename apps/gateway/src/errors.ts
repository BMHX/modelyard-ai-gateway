export class GatewayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

export function isGatewayHttpError(error: unknown): error is GatewayHttpError {
  return error instanceof GatewayHttpError;
}
