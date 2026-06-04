import { randomBytes } from "node:crypto";

function base64Secret(bytes = 32) {
  return randomBytes(bytes).toString("base64");
}

function urlSecret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function identifier(prefix) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

const generatedAt = new Date().toISOString();

console.log(`# Generated ${generatedAt}`);
console.log("# Review and store these values in your production secret manager before deploy.");
console.log("NODE_ENV=production");
console.log("DEMO_MODE=0");
console.log(`CONTROL_API_ADMIN_TOKEN=${urlSecret(24)}`);
console.log(`ENCRYPTION_KEY_BASE64=${base64Secret(32)}`);
console.log(`FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64=${base64Secret(32)}`);
console.log(`PRIVATE_RESPONSE_ATTESTATION_SECRET=${base64Secret(32)}`);
console.log(`PRIVATE_RESPONSE_ATTESTATION_KEY_ID=${identifier("prod-attest")}`);
console.log(`POSTGRES_PASSWORD=${urlSecret(18)}`);
console.log("WEB_ADMIN_BASE_URL=https://admin.example.com");
console.log("GATEWAY_PUBLIC_BASE_URL=https://gateway.example.com");
console.log("NEXT_PUBLIC_CONTROL_API_BASE_URL=https://api.example.com");
