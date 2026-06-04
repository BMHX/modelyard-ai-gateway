import { getWorkspaceSetupSummary, listWorkspacesByOrganization } from "../lib/control-api";

import type { WorkspacesPageData } from "./workspaces-page-state";

const setupSummaryConcurrency = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
}

export async function loadWorkspacesPageData(organizationId: string | null): Promise<WorkspacesPageData> {
  if (!organizationId) {
    return {
      organizationId: null,
      workspaces: [],
      setupSummariesByWorkspaceId: {},
    };
  }

  const workspaces = await listWorkspacesByOrganization(organizationId);
  const setupSummaryEntries = await mapWithConcurrency(workspaces, setupSummaryConcurrency, async (workspace) => {
    try {
      return [workspace.id, await getWorkspaceSetupSummary(workspace.id)] as const;
    } catch {
      return [workspace.id, null] as const;
    }
  });

  return {
    organizationId,
    workspaces,
    setupSummariesByWorkspaceId: Object.fromEntries(setupSummaryEntries),
  };
}
