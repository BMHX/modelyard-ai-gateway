import type { FastifyInstance } from "fastify";

import type { ControlApiContext } from "../context.js";
import { registerAlertRoutes } from "./alerts.js";
import { registerAuthRoutes } from "./auth.js";
import { registerBudgetRoutes } from "./budgets.js";
import { registerHealthRoutes } from "./health.js";
import { registerLineageRoutes } from "./lineage.js";
import { registerMemberRoutes } from "./members.js";
import { registerOrganizationRoutes } from "./organizations.js";
import { registerProjectRoutes } from "./projects.js";
import { registerPromptInspectionRoutes } from "./prompt-inspections.js";
import { registerProviderRoutes } from "./providers.js";
import { registerSavedViewRoutes } from "./saved-views.js";
import { registerScheduledReportRoutes } from "./scheduled-reports.js";
import { registerSelfServeVirtualKeyRoutes } from "./self-serve-virtual-keys.js";
import { registerUsageRoutes } from "./usage.js";
import { registerVirtualKeyRoutes } from "./virtual-keys.js";
import { registerWorkspaceRoutes } from "./workspaces.js";
import { registerWorkspaceModelCatalogRoutes } from "./workspace-model-catalog.js";

export async function registerRoutes(app: FastifyInstance, context: ControlApiContext) {
  await registerHealthRoutes(app, context);
  await registerAuthRoutes(app, context);
  await registerOrganizationRoutes(app, context);
  await registerWorkspaceRoutes(app, context);
  await registerWorkspaceModelCatalogRoutes(app, context);
  await registerProjectRoutes(app, context);
  await registerPromptInspectionRoutes(app, context);
  await registerMemberRoutes(app, context);
  await registerProviderRoutes(app, context);
  await registerVirtualKeyRoutes(app, context);
  await registerSelfServeVirtualKeyRoutes(app, context);
  await registerBudgetRoutes(app, context);
  await registerLineageRoutes(app, context);
  await registerUsageRoutes(app, context);
  await registerSavedViewRoutes(app, context);
  await registerScheduledReportRoutes(app, context);
  await registerAlertRoutes(app, context);
}
