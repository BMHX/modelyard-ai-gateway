import { requireAdminSurfaceAccess } from "../lib/admin-surface";
import { fetchAuthSession, resolveOrganizationSelection } from "../lib/control-api";

import { WorkspacesPageClient } from "./workspaces-page-client";
import { loadWorkspacesPageData } from "./workspaces-page-data";
import { parseWorkspacesUrlState } from "./workspaces-page-state";

export const dynamic = "force-dynamic";

type WorkspacesPageProps = {
  searchParams?: Promise<{
    organizationId?: string;
    focusWorkspaceId?: string;
    q?: string;
    view?: string;
    sort?: string;
    density?: string;
    columns?: string;
    review?: string;
    bucket?: string;
    create?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

export default async function WorkspacesPage({ searchParams }: WorkspacesPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialUrlState = parseWorkspacesUrlState(resolvedSearchParams);
  const adminAccess = await requireAdminSurfaceAccess();
  const { organizations, selectedOrganizationId } = await resolveOrganizationSelection(initialUrlState.organizationId);
  const initialData = await loadWorkspacesPageData(selectedOrganizationId);
  const authSession = await fetchAuthSession().catch(() => null);

  return (
    <WorkspacesPageClient
      adminWorkspaceId={adminAccess.workspaceSelection.selectedWorkspaceId}
      initialData={initialData}
      initialGuideExitedWorkspaceIds={authSession?.guideExitedWorkspaceIds ?? []}
      initialOrganizations={organizations}
      initialUrlState={{
        ...initialUrlState,
        organizationId: selectedOrganizationId,
      }}
    />
  );
}
