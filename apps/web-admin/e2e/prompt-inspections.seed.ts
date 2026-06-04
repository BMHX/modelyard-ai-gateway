import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  appendPromptInspection,
  createDatabase,
  createOrganization,
  createSavedView,
  createWorkspace,
  runMigrations,
  type Database,
} from "@teamops/database";

export type PromptInspectionsE2EManifest = {
  workspaceId: string;
  savedViewId: string;
  savedViewName: string;
  basePath: string;
  savedViewTargetHref: string;
  savedViewOpenHref: string;
};

export async function seedPromptInspectionsE2E(args: {
  databaseUrl: string;
  manifestPath: string;
  db?: Database;
}) {
  const db = args.db ?? createDatabase(args.databaseUrl);
  const ownsDatabase = !args.db;

  try {
    await runMigrations(db);

    const organization = await createOrganization(db, {
      name: "Prompt Inspection E2E Org",
    });
    const workspace = await createWorkspace(db, {
      organizationId: organization.id,
      name: "Prompt Inspection E2E Workspace",
    });

    for (let index = 0; index < 120; index += 1) {
      const inspection = await appendPromptInspection(db, {
        workspaceId: workspace.id,
        requestId: `e2e-review-${String(index + 1).padStart(3, "0")}`,
        provider: index % 2 === 0 ? "openai" : "anthropic",
        model: `model-${String((index % 5) + 1).padStart(2, "0")}`,
        verdict: "review",
        score: 200 - index,
        topActivityLabel: index % 3 === 0 ? "research" : "external_delivery",
        riskCategories: index % 2 === 0 ? ["personal_use"] : ["external_business"],
        hitRuleIds: [`e2e-rule-${index + 1}`],
        redactedEvidence: [`e2e-evidence-${index + 1}`],
        reviewStatus:
          index % 4 === 0
            ? "pending"
            : index % 4 === 1
              ? "needs_followup"
              : index % 4 === 2
                ? "confirmed_violation"
                : "confirmed_benign",
      });

      await db.query("update prompt_inspections set created_at = $2::timestamptz where id = $1", [
        inspection.id,
        `2026-04-${String(1 + Math.floor(index / 12)).padStart(2, "0")}T${String(8 + (index % 12)).padStart(2, "0")}:00:00.000Z`,
      ]);
    }

    const savedView = await createSavedView(db, {
      workspaceId: workspace.id,
      surface: "prompt-inspections",
      name: "Review queue",
      filters: {
        verdict: "review",
      },
    });

    const savedViewTargetHref = `/prompt-inspections?workspaceId=${workspace.id}&verdict=review&savedViewId=${savedView.id}`;
    const manifest: PromptInspectionsE2EManifest = {
      workspaceId: workspace.id,
      savedViewId: savedView.id,
      savedViewName: savedView.name,
      basePath: `/prompt-inspections?workspaceId=${workspace.id}`,
      savedViewTargetHref,
      savedViewOpenHref: `/saved-views/${savedView.id}/open?next=${encodeURIComponent(savedViewTargetHref)}`,
    };

    await mkdir(path.dirname(args.manifestPath), {
      recursive: true,
    });
    await writeFile(args.manifestPath, JSON.stringify(manifest, null, 2));

    return manifest;
  } finally {
    if (ownsDatabase) {
      await db.end();
    }
  }
}
