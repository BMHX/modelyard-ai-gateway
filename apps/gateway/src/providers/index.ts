import type { GatewayProviderRequest, GatewayProviderResult } from "./types.js";
import { invokeAnthropic } from "./anthropic.js";
import { invokeDemoProvider } from "./demo.js";
import { invokeOpenAiCompatible } from "./openai-compatible.js";

export async function invokeProvider(request: GatewayProviderRequest): Promise<GatewayProviderResult> {
  if (request.demoMode) {
    return invokeDemoProvider(request);
  }

  if (request.providerConnection.provider === "anthropic") {
    return invokeAnthropic(request);
  }

  return invokeOpenAiCompatible(request);
}
