import { Suspense } from "react";
import { type Metadata } from "next";

import { loadWorkspaceSelection } from "@/app/lib/control-api";
import { getCurrentLocale } from "@/app/lib/i18n-server";

import { ModelsView } from "./models-view";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getCurrentLocale();
  return {
    title: locale === "zh" ? "模型" : "Models",
  };
}

export default async function ModelsPage() {
  const locale = await getCurrentLocale();

  const workspaceSelection = await loadWorkspaceSelection();
  const explicitWorkspaceId = workspaceSelection.selectedWorkspaceId;

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        }
      >
        <ModelsView locale={locale} workspaceId={explicitWorkspaceId} />
      </Suspense>
    </div>
  );
}
