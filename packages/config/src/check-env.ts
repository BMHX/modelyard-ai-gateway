import path from "node:path";

import { getRepoRoot, loadRootEnv, parseControlApiEnv, parseGatewayEnv, parseWebAdminEnv, resolveEnvProfile } from "./index.js";

const profile = resolveEnvProfile();
const { loadedFiles } = loadRootEnv({ profile, required: true });

const repoRoot = getRepoRoot();

const controlApiEnv = parseControlApiEnv();
const gatewayEnv = parseGatewayEnv();
const webAdminEnv = parseWebAdminEnv();

console.log("Environment OK.");
console.log(`Profile: ${profile}`);
console.log(`Loaded env files: ${loadedFiles.map((file) => path.basename(file)).join(", ")}`);
console.log(`Control API: http://${controlApiEnv.CONTROL_API_HOST}:${controlApiEnv.CONTROL_API_PORT}`);
console.log(`Gateway: ${gatewayEnv.GATEWAY_PUBLIC_BASE_URL}`);
console.log(`Web Admin -> Control API: ${webAdminEnv.NEXT_PUBLIC_CONTROL_API_BASE_URL}`);
console.log(`Web Admin auth mode: ${webAdminEnv.WEB_ADMIN_AUTH_MODE}`);
console.log(`Repo root: ${repoRoot}`);
