import crypto from "node:crypto";

const defaultAlphabetSize = 4;
const parityInterval = 12;
const decoyInterval = 11;

function createHmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest();
}

function digestToUnitInterval(buffer) {
  const value = buffer.readUInt32BE(0);
  return (value + 1) / (0xffffffff + 2);
}

function drawQaryWeights(secret, siteId, alphabetSize) {
  const rawWeights = [];
  let total = 0;

  for (let index = 0; index < alphabetSize; index += 1) {
    const uniform = digestToUnitInterval(
      createHmac(secret, `bias:${siteId}:${index}`),
    );
    const weight = -Math.log(uniform);
    rawWeights.push(weight);
    total += weight;
  }

  return rawWeights.map((weight) => weight / total);
}

function sampleQarySymbol(secret, profile, siteId, weights) {
  const threshold = digestToUnitInterval(
    createHmac(secret, `sample:${profile}:${siteId}`),
  );
  let cumulative = 0;

  for (let symbol = 0; symbol < weights.length; symbol += 1) {
    cumulative += weights[symbol];
    if (threshold <= cumulative || symbol === weights.length - 1) {
      return symbol;
    }
  }

  return 0;
}

export function buildSemanticCodeword({
  alphabetSize = defaultAlphabetSize,
  context,
  sites,
}) {
  const orderedSites = [...sites].sort((left, right) =>
    left.siteId.localeCompare(right.siteId),
  );
  const assignments = [];
  const scoredSymbols = [];

  for (let index = 0; index < orderedSites.length; index += 1) {
    const site = orderedSites[index];
    const isParitySite = index > 0 && (index + 1) % parityInterval === 0;
    const isDecoySite = !isParitySite && (index + 1) % decoyInterval === 0;
    const weights = drawQaryWeights(context.secret, site.siteId, alphabetSize);

    let symbol;
    let role = "primary";

    if (isParitySite) {
      role = "parity";
      const parityStart = Math.max(0, scoredSymbols.length - (parityInterval - 1));
      const parityWindow = scoredSymbols.slice(parityStart);
      symbol =
        parityWindow.reduce((total, value) => total + value, 0) % alphabetSize;
    } else {
      symbol = sampleQarySymbol(
        context.secret,
        context.profile,
        site.siteId,
        weights,
      );

      if (isDecoySite) {
        role = "decoy";
      } else {
        scoredSymbols.push(symbol);
      }
    }

    assignments.push({
      ...site,
      alphabetSize,
      role,
      symbol,
      weights: role === "decoy" ? undefined : weights.map((value) => Number(value.toFixed(6))),
    });
  }

  return {
    alphabetSize,
    assignmentCount: assignments.length,
    assignments,
    codewordDigest: crypto
      .createHash("sha256")
      .update(
        assignments
          .map((assignment) =>
            [
              assignment.siteId,
              assignment.symbol,
              assignment.role,
            ].join(":"),
          )
          .join("|"),
      )
      .digest("hex"),
  };
}
