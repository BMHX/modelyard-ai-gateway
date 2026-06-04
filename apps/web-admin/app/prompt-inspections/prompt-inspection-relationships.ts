import type { PromptInspection, UsageEvent } from "@teamops/contracts";

type AppLocale = "zh" | "en";

export type PromptInspectionRelationshipNodeKind =
  | "inspection"
  | "usage-event"
  | "virtual-key"
  | "provider-connection"
  | "project"
  | "environment";

export type PromptInspectionRelationshipNode = {
  kind: PromptInspectionRelationshipNodeKind;
  relationLabel: string;
  title: string;
  value: string;
  meta: string | null;
  href: string | null;
  actionLabel: string | null;
};

export type PromptInspectionRelationshipModel = {
  center: PromptInspectionRelationshipNode;
  nodes: PromptInspectionRelationshipNode[];
};

type PromptInspectionRelationshipArgs = {
  locale: AppLocale;
  inspection: Pick<
    PromptInspection,
    "id" | "requestId" | "workspaceId" | "projectId" | "environmentId" | "virtualKeyId" | "providerConnectionId"
  >;
  linkedUsageEvent: Pick<UsageEvent, "id"> | null;
  projectName?: string | null;
  environmentName?: string | null;
  environmentRuntime?: string | null;
  virtualKeyLabel?: string | null;
  providerConnectionLabel?: string | null;
  returnTo: string;
};

function buildUsageEventHref(usageEventId: string, returnTo: string) {
  return `/usage-events/${usageEventId}?returnTo=${encodeURIComponent(returnTo)}`;
}

function buildUsageEventsScopedHref(args: {
  workspaceId: string;
  virtualKeyId?: string | null;
  providerConnectionId?: string | null;
  returnTo: string;
}) {
  const params = new URLSearchParams();
  params.set("workspaceId", args.workspaceId);

  if (args.virtualKeyId) {
    params.set("virtualKeyId", args.virtualKeyId);
  }

  if (args.providerConnectionId) {
    params.set("providerConnectionId", args.providerConnectionId);
  }

  params.set("returnTo", args.returnTo);
  return `/usage-events?${params.toString()}`;
}

function getCopy(locale: AppLocale) {
  if (locale === "zh") {
    return {
      centerRelation: "当前记录",
      centerTitle: "内容审查记录",
      inspectionId: "检查 ID",
      usageRelation: "关联用量事件",
      usageTitle: "Usage event",
      usageMeta: "沿证据链继续调查当前请求。",
      usageAction: "打开用量详情",
      virtualKeyRelation: "通过该访问路径",
      virtualKeyTitle: "Virtual key",
      virtualKeyAction: "查看该密钥用量",
      providerConnectionRelation: "路由经过",
      providerConnectionTitle: "Provider connection",
      providerConnectionAction: "查看该连接用量",
      projectRelation: "作用域归属",
      projectTitle: "Project",
      environmentRelation: "环境归属",
      environmentTitle: "Environment",
      scopeMeta: "当前治理范围",
    };
  }

  return {
    centerRelation: "Current record",
    centerTitle: "Content review record",
    inspectionId: "Inspection ID",
    usageRelation: "Linked usage event",
    usageTitle: "Usage event",
    usageMeta: "Continue through the linked evidence chain.",
    usageAction: "Open usage detail",
    virtualKeyRelation: "Access path",
    virtualKeyTitle: "Virtual key",
    virtualKeyAction: "View key usage",
    providerConnectionRelation: "Routed through",
    providerConnectionTitle: "Provider connection",
    providerConnectionAction: "View provider usage",
    projectRelation: "Scoped to",
    projectTitle: "Project",
    environmentRelation: "Environment scope",
    environmentTitle: "Environment",
    scopeMeta: "Current governance scope",
  };
}

function getDisplayValue(preferred: string | null | undefined, fallback: string) {
  const normalized = preferred?.trim();
  return normalized ? normalized : fallback;
}

function getSecondaryIdentifier(preferred: string | null | undefined, fallback: string | null) {
  const normalized = preferred?.trim();
  if (!fallback || !normalized || normalized === fallback) {
    return null;
  }

  return fallback;
}

export function buildPromptInspectionRelationshipModel(
  args: PromptInspectionRelationshipArgs,
): PromptInspectionRelationshipModel {
  const copy = getCopy(args.locale);
  const nodes: PromptInspectionRelationshipNode[] = [];

  const center: PromptInspectionRelationshipNode = {
    kind: "inspection",
    relationLabel: copy.centerRelation,
    title: copy.centerTitle,
    value: args.inspection.requestId,
    meta: `${copy.inspectionId} · ${args.inspection.id}`,
    href: null,
    actionLabel: null,
  };

  if (args.linkedUsageEvent) {
    nodes.push({
      kind: "usage-event",
      relationLabel: copy.usageRelation,
      title: copy.usageTitle,
      value: args.linkedUsageEvent.id,
      meta: copy.usageMeta,
      href: buildUsageEventHref(args.linkedUsageEvent.id, args.returnTo),
      actionLabel: copy.usageAction,
    });
  }

  if (args.inspection.virtualKeyId) {
    const value = getDisplayValue(args.virtualKeyLabel, args.inspection.virtualKeyId);
    nodes.push({
      kind: "virtual-key",
      relationLabel: copy.virtualKeyRelation,
      title: copy.virtualKeyTitle,
      value,
      meta: getSecondaryIdentifier(args.virtualKeyLabel, args.inspection.virtualKeyId),
      href: buildUsageEventsScopedHref({
        workspaceId: args.inspection.workspaceId,
        virtualKeyId: args.inspection.virtualKeyId,
        returnTo: args.returnTo,
      }),
      actionLabel: copy.virtualKeyAction,
    });
  }

  if (args.inspection.providerConnectionId) {
    const value = getDisplayValue(args.providerConnectionLabel, args.inspection.providerConnectionId);
    nodes.push({
      kind: "provider-connection",
      relationLabel: copy.providerConnectionRelation,
      title: copy.providerConnectionTitle,
      value,
      meta: getSecondaryIdentifier(args.providerConnectionLabel, args.inspection.providerConnectionId),
      href: buildUsageEventsScopedHref({
        workspaceId: args.inspection.workspaceId,
        providerConnectionId: args.inspection.providerConnectionId,
        returnTo: args.returnTo,
      }),
      actionLabel: copy.providerConnectionAction,
    });
  }

  if (args.inspection.projectId) {
    nodes.push({
      kind: "project",
      relationLabel: copy.projectRelation,
      title: copy.projectTitle,
      value: getDisplayValue(args.projectName, args.inspection.projectId),
      meta: getSecondaryIdentifier(args.projectName, args.inspection.projectId) ?? copy.scopeMeta,
      href: null,
      actionLabel: null,
    });
  }

  if (args.inspection.environmentId) {
    nodes.push({
      kind: "environment",
      relationLabel: copy.environmentRelation,
      title: copy.environmentTitle,
      value: getDisplayValue(args.environmentName, args.inspection.environmentId),
      meta:
        args.environmentRuntime?.trim() ||
        getSecondaryIdentifier(args.environmentName, args.inspection.environmentId) ||
        copy.scopeMeta,
      href: null,
      actionLabel: null,
    });
  }

  return {
    center,
    nodes,
  };
}
