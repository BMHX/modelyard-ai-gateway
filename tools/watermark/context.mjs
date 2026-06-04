import crypto from "node:crypto";
import fs from "node:fs";

const base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

function hmacDigest(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest();
}

function encodeBase32(buffer) {
  let output = "";
  let bits = 0;
  let value = 0;

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

export function readWatermarkContext(env = process.env) {
  const descriptorPath =
    env.TEAMOPS_LINEAGE_DESCRIPTOR_PATH?.trim() ||
    env.TEAMOPS_WATERMARK_DESCRIPTOR_PATH?.trim() ||
    null;
  const secret =
    env.TEAMOPS_LINEAGE_SECRET?.trim() ||
    env.TEAMOPS_WATERMARK_SECRET?.trim();
  const explicitProfile =
    env.TEAMOPS_LINEAGE_PROFILE?.trim() ||
    env.TEAMOPS_WATERMARK_PROFILE?.trim();
  const customerId =
    env.TEAMOPS_LINEAGE_CUSTOMER?.trim() ||
    env.TEAMOPS_WATERMARK_CUSTOMER?.trim();
  const deploymentId =
    env.TEAMOPS_LINEAGE_DEPLOYMENT?.trim() ||
    env.TEAMOPS_WATERMARK_DEPLOYMENT?.trim();
  const releaseId =
    env.TEAMOPS_LINEAGE_RELEASE?.trim() ||
    env.TEAMOPS_WATERMARK_RELEASE?.trim();
  const buildChannel =
    env.TEAMOPS_LINEAGE_CHANNEL?.trim() ||
    env.TEAMOPS_WATERMARK_CHANNEL?.trim() || "private-delivery";
  const schemeVersion =
    env.TEAMOPS_LINEAGE_SCHEME_VERSION?.trim() ||
    env.TEAMOPS_WATERMARK_SCHEME_VERSION?.trim() || "wm.v1";
  const required =
    env.TEAMOPS_LINEAGE_REQUIRED?.trim() === "1" ||
    env.TEAMOPS_OFFICIAL_RELEASE?.trim() === "1";

  if (!secret) {
    if (required) {
      throw new Error("Official lineage builds require TEAMOPS_LINEAGE_SECRET");
    }
    return null;
  }

  let descriptor = null;
  if (descriptorPath) {
    descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  } else if (required) {
    throw new Error("Official lineage builds require TEAMOPS_LINEAGE_DESCRIPTOR_PATH");
  }

  const descriptorCustomerId =
    typeof descriptor?.customerId === "string" ? descriptor.customerId.trim() : null;
  const descriptorDeploymentId =
    typeof descriptor?.deploymentId === "string" ? descriptor.deploymentId.trim() : null;
  const descriptorReleaseId =
    typeof descriptor?.releaseId === "string" ? descriptor.releaseId.trim() : null;
  const descriptorManifestHash =
    typeof descriptor?.manifestHash === "string" ? descriptor.manifestHash.trim() : null;
  const descriptorSchemeVersion =
    typeof descriptor?.schemeVersion === "string" ? descriptor.schemeVersion.trim() : null;
  const descriptorChannel =
    typeof descriptor?.channel === "string" ? descriptor.channel.trim() : null;
  const descriptorProfile =
    typeof descriptor?.watermarkProfile === "string" ? descriptor.watermarkProfile.trim() : null;

  const profile =
    descriptorProfile ||
    explicitProfile ||
    [descriptorCustomerId ?? customerId, descriptorDeploymentId ?? deploymentId, descriptorReleaseId ?? releaseId]
      .filter(Boolean)
      .join(":");

  if (!profile) {
    if (required) {
      throw new Error(
        "Official lineage builds require TEAMOPS_LINEAGE_PROFILE or TEAMOPS_LINEAGE_{CUSTOMER,DEPLOYMENT,RELEASE}",
      );
    }
    return null;
  }

  const metadata = {
    buildChannel: descriptorChannel || buildChannel,
    customerId: descriptorCustomerId || customerId || "unknown-customer",
    deploymentId: descriptorDeploymentId || deploymentId || "unknown-deployment",
    profile,
    releaseId: descriptorReleaseId || releaseId || "unknown-release",
    manifestHash: descriptorManifestHash || null,
    schemeVersion: descriptorSchemeVersion || schemeVersion,
    descriptorPath,
  };

  const canonicalMetadata = [
    metadata.schemeVersion,
    metadata.buildChannel,
    metadata.customerId,
    metadata.deploymentId,
    metadata.releaseId,
    metadata.profile,
    metadata.manifestHash ?? "",
  ].join("|");

  const locator = encodeBase32(
    hmacDigest(secret, `locator:${canonicalMetadata}`),
  ).slice(0, 16);

  return {
    ...metadata,
    canonicalMetadata,
    descriptor,
    locator,
    reportSchema: "teamops.semantic-watermark.report.v1",
    secret,
  };
}

export function shouldEnableWatermark(env = process.env) {
  return Boolean(readWatermarkContext(env));
}

export function redactWatermarkContext(context) {
  if (!context) {
    return null;
  }

  const { secret: _secret, ...safeContext } = context;
  return safeContext;
}
