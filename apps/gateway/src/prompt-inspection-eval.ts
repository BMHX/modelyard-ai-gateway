import type {
  PromptInspectionVerdict,
  PromptPolicy,
  PromptRiskCategory,
} from "@teamops/contracts";

import {
  promptInspectionEvalCorpus,
  promptInspectionEvalThresholds,
  type PromptInspectionEvalCase,
  type PromptInspectionEvalCategory,
} from "./prompt-inspection-data/corpus.js";
import { inspectPromptInput, recordPromptInspectionContext, resetPromptInspectionContext } from "./prompt-inspection.js";

type EvalResult = PromptInspectionEvalCase & {
  actualVerdict: PromptInspectionVerdict | null;
  actualRiskCategories: PromptRiskCategory[];
  score: number;
  exactVerdictMatch: boolean;
  riskRecall: number;
  evidenceSafe: boolean;
};

function createPolicy(overrides?: Partial<PromptPolicy>): PromptPolicy {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    enabled: true,
    enforcementMode: "graded",
    evidenceMode: "redacted_snippet",
    reviewThreshold: 60,
    blockThreshold: 100,
    allowedExternalDomains: [],
    allowedKeywordOverrides: [],
    disabledRuleIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function containsUnredactedSecret(evidence: string) {
  return /sk-ant-api03-[A-Za-z0-9_-]{20,}|\bbearer\s+[a-z0-9._-]{20,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/i.test(
    evidence,
  );
}

function calculateRiskRecall(expectedRiskCategories: PromptRiskCategory[], actualRiskCategories: PromptRiskCategory[]) {
  if (!expectedRiskCategories.length) {
    return actualRiskCategories.length === 0 ? 1 : 0;
  }

  return (
    expectedRiskCategories.filter((category) => actualRiskCategories.includes(category)).length /
    expectedRiskCategories.length
  );
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function calculateMetrics(results: EvalResult[]) {
  const exactAccuracy = results.filter((item) => item.exactVerdictMatch).length / results.length;
  const averageRiskRecall = results.reduce((sum, item) => sum + item.riskRecall, 0) / results.length;
  const evidenceSafeRate = results.filter((item) => item.evidenceSafe).length / results.length;
  const blockExpected = results.filter((item) => item.expectedVerdict === "block");
  const blockRecall = blockExpected.length
    ? blockExpected.filter((item) => item.actualVerdict === "block").length / blockExpected.length
    : 1;

  return {
    total: results.length,
    exactAccuracy: round(exactAccuracy),
    averageRiskRecall: round(averageRiskRecall),
    evidenceSafeRate: round(evidenceSafeRate),
    blockRecall: round(blockRecall),
    falsePositiveCount: results.filter((item) => item.expectedVerdict === null && item.actualVerdict !== null).length,
    falseNegativeCount: results.filter((item) => item.expectedVerdict !== null && item.actualVerdict === null).length,
    overBlockingCount: results.filter((item) => item.expectedVerdict !== "block" && item.actualVerdict === "block").length,
  };
}

function buildVerdictMetrics(results: EvalResult[]) {
  return Object.fromEntries(
    [null, "allow_with_record", "review", "block"].map((expectedVerdict) => {
      const subset = results.filter((item) => item.expectedVerdict === expectedVerdict);
      const metrics = subset.length
        ? calculateMetrics(subset)
        : {
            total: 0,
            exactAccuracy: 1,
            averageRiskRecall: 1,
            evidenceSafeRate: 1,
            blockRecall: 1,
            falsePositiveCount: 0,
            falseNegativeCount: 0,
            overBlockingCount: 0,
          };

      return [expectedVerdict ?? "clean", metrics];
    }),
  );
}

function buildCategoryMetrics(results: EvalResult[]) {
  const categories = [...new Set(results.map((item) => item.category))].sort();
  return Object.fromEntries(
    categories.map((category) => {
      const subset = results.filter((item) => item.category === category);
      return [
        category,
        {
          ...calculateMetrics(subset),
          expectedVerdictBreakdown: Object.fromEntries(
            [null, "allow_with_record", "review", "block"].map((expectedVerdict) => [
              expectedVerdict ?? "clean",
              subset.filter((item) => item.expectedVerdict === expectedVerdict).length,
            ]),
          ),
        },
      ];
    }),
  ) as Record<PromptInspectionEvalCategory, ReturnType<typeof calculateMetrics> & { expectedVerdictBreakdown: Record<string, number> }>;
}

function buildRiskCategoryRecall(results: EvalResult[]) {
  const categories = [...new Set(results.flatMap((item) => item.expectedRiskCategories))].sort();
  return Object.fromEntries(
    categories.map((riskCategory) => {
      const subset = results.filter((item) => item.expectedRiskCategories.includes(riskCategory));
      const recall = subset.length
        ? subset.filter((item) => item.actualRiskCategories.includes(riskCategory)).length / subset.length
        : 1;
      return [riskCategory, round(recall)];
    }),
  ) as Record<PromptRiskCategory, number>;
}

function evaluateCorpus() {
  resetPromptInspectionContext();
  const results = promptInspectionEvalCorpus.map((sample, index) => {
    const policy = createPolicy(sample.policyOverrides);

    if (sample.contextSeed) {
      for (let iteration = 0; iteration < sample.contextSeed.count; iteration += 1) {
        recordPromptInspectionContext({
          virtualKeyId: `eval-${index}`,
          verdict: sample.contextSeed.verdict,
          riskCategories: sample.contextSeed.riskCategories,
          simhash: sample.contextSeed.simhash ?? null,
        });
      }
    }

    const result = inspectPromptInput({
      body: {
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "user",
            content: sample.text,
          },
        ],
      },
      path: sample.path ?? "/v1/chat/completions",
      virtualKey: {
        id: `eval-${index}`,
      },
      policy,
    });

    const actualVerdict = result?.verdict ?? null;
    const actualRiskCategories = result?.riskCategories ?? [];
    const evidenceSafe = (result?.redactedEvidence ?? []).every((entry) => !containsUnredactedSecret(entry));

    return {
      ...sample,
      actualVerdict,
      actualRiskCategories,
      score: result?.score ?? 0,
      exactVerdictMatch: actualVerdict === sample.expectedVerdict,
      riskRecall: calculateRiskRecall(sample.expectedRiskCategories, actualRiskCategories),
      evidenceSafe,
    } satisfies EvalResult;
  });

  const summary = calculateMetrics(results);
  const verdictMetrics = buildVerdictMetrics(results);
  const categoryMetrics = buildCategoryMetrics(results);
  const riskCategoryRecall = buildRiskCategoryRecall(results);
  const thresholdFailures: string[] = [];

  if (summary.exactAccuracy < promptInspectionEvalThresholds.exactAccuracyFloor) {
    thresholdFailures.push(
      `overall exact accuracy ${summary.exactAccuracy} < ${promptInspectionEvalThresholds.exactAccuracyFloor}`,
    );
  }
  if (summary.blockRecall < promptInspectionEvalThresholds.blockRecallFloor) {
    thresholdFailures.push(
      `block recall ${summary.blockRecall} < ${promptInspectionEvalThresholds.blockRecallFloor}`,
    );
  }
  if (summary.evidenceSafeRate < promptInspectionEvalThresholds.evidenceSafeRateFloor) {
    thresholdFailures.push(
      `evidence safety ${summary.evidenceSafeRate} < ${promptInspectionEvalThresholds.evidenceSafeRateFloor}`,
    );
  }

  for (const riskCategory of promptInspectionEvalThresholds.highRiskCategories) {
    const recall = riskCategoryRecall[riskCategory] ?? 1;
    if (recall < promptInspectionEvalThresholds.highRiskCategoryRecallFloor) {
      thresholdFailures.push(
        `${riskCategory} recall ${recall} < ${promptInspectionEvalThresholds.highRiskCategoryRecallFloor}`,
      );
    }
  }

  const weakestCategoryEntry = Object.entries(categoryMetrics)
    .sort((left, right) => left[1].exactAccuracy - right[1].exactAccuracy || left[0].localeCompare(right[0]))[0] ?? null;

  const humanSummaryLines = [
    `Prompt inspection eval: ${summary.total} cases`,
    `Exact accuracy: ${summary.exactAccuracy}`,
    `Average risk recall: ${summary.averageRiskRecall}`,
    `Block recall: ${summary.blockRecall}`,
    `Evidence safety: ${summary.evidenceSafeRate}`,
    `Weakest category: ${weakestCategoryEntry ? `${weakestCategoryEntry[0]} (${weakestCategoryEntry[1].exactAccuracy})` : "n/a"}`,
    `Threshold failures: ${thresholdFailures.length ? thresholdFailures.join("; ") : "none"}`,
  ];

  return {
    summary,
    verdictMetrics,
    categoryMetrics,
    riskCategoryRecall,
    thresholds: promptInspectionEvalThresholds,
    thresholdFailures,
    humanSummaryLines,
    results: results.map((item) => ({
      id: item.id,
      category: item.category,
      expectedVerdict: item.expectedVerdict,
      actualVerdict: item.actualVerdict,
      expectedRiskCategories: item.expectedRiskCategories,
      actualRiskCategories: item.actualRiskCategories,
      score: item.score,
      exactVerdictMatch: item.exactVerdictMatch,
      riskRecall: round(item.riskRecall),
      evidenceSafe: item.evidenceSafe,
    })),
  };
}

const evaluation = evaluateCorpus();

if (evaluation.thresholdFailures.length) {
  process.exitCode = 1;
}

console.error(evaluation.humanSummaryLines.join("\n"));
console.log(JSON.stringify(evaluation, null, 2));
