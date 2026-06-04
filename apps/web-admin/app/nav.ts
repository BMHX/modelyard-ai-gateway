import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Blocks,
  Building2,
  ClipboardList,
  FileUp,
  FolderKanban,
  House,
  KeyRound,
  PlugZap,
  ReceiptText,
  ScanSearch,
  Settings2,
  SquareTerminal,
  Users,
} from "lucide-react";

import { type Capabilities } from "./lib/capabilities";

export type NavItem = {
  href: string;
  label: string;
  description: string;
  keywords?: string[];
  icon?: LucideIcon;
};

export type NavSection = {
  label: string;
  description: string;
  items: NavItem[];
};

const shellKey = (value: string) => `shell.${value}`;

function hasResolvedNavigationCapabilities(capabilities: Capabilities) {
  return Object.values(capabilities).some(Boolean);
}

export const homeNavItem: NavItem = {
  href: "/",
  label: shellKey("navigation.items.home.label"),
  description: shellKey("navigation.items.home.description"),
  keywords: ["today", "dashboard", "home", "action center", "readiness"],
  icon: House,
};

export function getNavSections(capabilities: Capabilities): NavSection[] {
  const sections: NavSection[] = [];

  if (!hasResolvedNavigationCapabilities(capabilities)) {
    return sections;
  }

  if (capabilities.canSelfServeVirtualKeys) {
    sections.push({
      label: shellKey("taskLane.workspace.label"),
      description: shellKey("taskLane.workspace.description"),
      items: [
        {
          href: "/models",
          label: shellKey("navigation.items.models.label"),
          description: shellKey("navigation.items.models.description"),
          keywords: ["models", "catalog", "providers", "capabilities"],
          icon: Blocks,
        },
        {
          href: "/access",
          label: shellKey("navigation.items.access.label"),
          description: shellKey("navigation.items.access.description"),
          keywords: ["access", "keys", "snippets", "gateway", "integration"],
          icon: SquareTerminal,
        },
      ],
    });

    return sections;
  }

  if (!capabilities.canAccessAdminSurfaces && capabilities.canManageGovernance) {
    sections.push({
      label: shellKey("navigation.sections.operations.label"),
      description: shellKey("navigation.sections.operations.description"),
      items: [
        {
          href: "/budgets",
          label: shellKey("navigation.items.budgets.label"),
          description: shellKey("navigation.items.budgets.description"),
          keywords: ["finance", "budget", "spend", "forecast"],
          icon: ReceiptText,
        },
        {
          href: "/audit-logs",
          label: shellKey("navigation.items.audit.label"),
          description: shellKey("navigation.items.audit.description"),
          keywords: ["audit", "changes", "history"],
          icon: ClipboardList,
        },
        {
          href: "/exports",
          label: shellKey("navigation.items.exports.label"),
          description: shellKey("navigation.items.exports.description"),
          keywords: ["exports", "reports", "evidence"],
          icon: FileUp,
        },
      ],
    });

    return sections;
  }

  sections.push({
    label: shellKey("navigation.sections.configuration.label"),
    description: shellKey("navigation.sections.configuration.description"),
    items: [
      {
        href: "/organizations",
        label: shellKey("navigation.items.orgs.label"),
        description: shellKey("navigation.items.orgs.description"),
        keywords: ["organization", "tenant", "onboarding", "billing", "ownership"],
        icon: Building2,
      },
      {
        href: "/workspaces",
        label: shellKey("navigation.items.workspaces.label"),
        description: shellKey("navigation.items.workspaces.description"),
        keywords: ["workspace", "workspace directory", "switch", "activation"],
        icon: Blocks,
      },
      {
        href: "/providers",
        label: shellKey("navigation.items.providers.label"),
        description: shellKey("navigation.items.providers.description"),
        keywords: ["providers", "provider connections", "routing", "health", "models", "gateway"],
        icon: PlugZap,
      },
      {
        href: "/settings",
        label: shellKey("navigation.items.settings.label"),
        description: shellKey("navigation.items.settings.description"),
        keywords: ["settings", "gateway endpoint", "request path", "runtime", "configuration"],
        icon: Settings2,
      },
    ],
  });

  sections.push({
    label: shellKey("navigation.sections.permissions.label"),
    description: shellKey("navigation.sections.permissions.description"),
    items: [
      {
        href: "/projects",
        label: shellKey("navigation.items.projects.label"),
        description: shellKey("navigation.items.projects.description"),
        keywords: ["projects", "environments", "scope", "assignment", "boundaries"],
        icon: FolderKanban,
      },
      {
        href: "/members",
        label: shellKey("navigation.items.members.label"),
        description: shellKey("navigation.items.members.description"),
        keywords: ["access", "identity", "invite", "roster", "permissions"],
        icon: Users,
      },
      {
        href: "/virtual-keys",
        label: shellKey("navigation.items.keys.label"),
        description: shellKey("navigation.items.keys.description"),
        keywords: ["keys", "rotate", "credentials", "token", "secrets"],
        icon: KeyRound,
      },
    ],
  });

  sections.push({
    label: shellKey("navigation.sections.operations.label"),
    description: shellKey("navigation.sections.operations.description"),
    items: [
      {
        href: "/usage-events",
        label: shellKey("navigation.items.usage.label"),
        description: shellKey("navigation.items.usage.description"),
        keywords: ["traffic", "usage", "usage events", "events", "requests", "logs"],
        icon: Activity,
      },
      {
        href: "/budgets",
        label: shellKey("navigation.items.budgets.label"),
        description: shellKey("navigation.items.budgets.description"),
        keywords: ["finance", "budget", "spend", "forecast", "burn"],
        icon: ReceiptText,
      },
      {
        href: "/alerts",
        label: shellKey("navigation.items.alerts.label"),
        description: shellKey("navigation.items.alerts.description"),
        keywords: ["incidents", "risk", "alerts", "triage"],
        icon: Bell,
      },
    ],
  });

  sections.push({
    label: shellKey("navigation.sections.reporting.label"),
    description: shellKey("navigation.sections.reporting.description"),
    items: [
      {
        href: "/audit-logs",
        label: shellKey("navigation.items.audit.label"),
        description: shellKey("navigation.items.audit.description"),
        keywords: ["audit", "audit logs", "changes", "history", "evidence"],
        icon: ClipboardList,
      },
      {
        href: "/prompt-inspections",
        label: shellKey("navigation.items.inspections.label"),
        description: shellKey("navigation.items.inspections.description"),
        keywords: ["inspections", "content review", "prompts", "governance", "flagged"],
        icon: ScanSearch,
      },
      {
        href: "/exports",
        label: shellKey("navigation.items.exports.label"),
        description: shellKey("navigation.items.exports.description"),
        keywords: ["exports", "reports", "evidence"],
        icon: FileUp,
      },
    ],
  });

  return sections;
}

export const navSections: NavSection[] = [];
