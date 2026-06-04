import enAlerts from "./en/alerts.json";
import enAudit from "./en/audit.json";
import enBudgets from "./en/budgets.json";
import enErrors from "./en/errors.json";
import enExports from "./en/exports.json";
import enHome from "./en/home.json";
import enLayout from "./en/layout.json";
import enLogin from "./en/login.json";
import enMembers from "./en/members.json";
import enOrganizations from "./en/organizations.json";
import enProjects from "./en/projects.json";
import enProviders from "./en/providers.json";
import enShared from "./en/shared.json";
import enShell from "./en/shell.json";
import enUsage from "./en/usage.json";
import enVirtualKeys from "./en/virtualKeys.json";
import enWorkspaces from "./en/workspaces.json";
import zhAlerts from "./zh/alerts.json";
import zhAudit from "./zh/audit.json";
import zhBudgets from "./zh/budgets.json";
import zhErrors from "./zh/errors.json";
import zhExports from "./zh/exports.json";
import zhHome from "./zh/home.json";
import zhLayout from "./zh/layout.json";
import zhLogin from "./zh/login.json";
import zhMembers from "./zh/members.json";
import zhOrganizations from "./zh/organizations.json";
import zhProjects from "./zh/projects.json";
import zhProviders from "./zh/providers.json";
import zhShared from "./zh/shared.json";
import zhShell from "./zh/shell.json";
import zhUsage from "./zh/usage.json";
import zhVirtualKeys from "./zh/virtualKeys.json";
import zhWorkspaces from "./zh/workspaces.json";

export const messageCatalog = {
  en: {
    alerts: enAlerts,
    audit: enAudit,
    budgets: enBudgets,
    exports: enExports,
    errors: enErrors,
    home: enHome,
    layout: enLayout,
    login: enLogin,
    members: enMembers,
    organizations: enOrganizations,
    projects: enProjects,
    providers: enProviders,
    shared: enShared,
    shell: enShell,
    usage: enUsage,
    virtualKeys: enVirtualKeys,
    workspaces: enWorkspaces,
  },
  zh: {
    alerts: zhAlerts,
    audit: zhAudit,
    budgets: zhBudgets,
    exports: zhExports,
    errors: zhErrors,
    home: zhHome,
    layout: zhLayout,
    login: zhLogin,
    members: zhMembers,
    organizations: zhOrganizations,
    projects: zhProjects,
    providers: zhProviders,
    shared: zhShared,
    shell: zhShell,
    usage: zhUsage,
    virtualKeys: zhVirtualKeys,
    workspaces: zhWorkspaces,
  },
} as const;
