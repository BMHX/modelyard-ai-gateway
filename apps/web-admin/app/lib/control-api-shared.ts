export function getControlApiBaseUrl() {
  return process.env.CONTROL_API_BASE_URL ?? process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ?? "http://127.0.0.1:4001";
}

export function getGatewayBaseUrl() {
  return process.env.GATEWAY_PUBLIC_BASE_URL ?? "http://127.0.0.1:4002";
}
