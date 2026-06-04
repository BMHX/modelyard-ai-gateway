export const watermarkScopesByLabel = {
  "control-api": [
    "apps/control-api/src",
  ],
  desktop: [
    "apps/desktop",
  ],
  gateway: [
    "apps/gateway/src",
  ],
  "runtime-image": [
    "apps/control-api/src",
    "apps/gateway/src",
    "apps/desktop",
    "apps/web-admin/app",
  ],
  "web-admin": [
    "apps/web-admin/app",
    "apps/web-admin/next.config.mjs",
  ],
};

export const supportedSourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

export function resolveWatermarkScopes(label) {
  return watermarkScopesByLabel[label] ?? [];
}
