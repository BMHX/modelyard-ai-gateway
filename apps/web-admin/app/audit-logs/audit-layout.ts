import type { ResourceSummaryStripItem } from "../components/resource-summary-strip";
import type { SavedViewBarItem, SavedViewBarSection } from "../components/saved-view-bar";

export type AuditActiveFilterChip = {
  label: string;
  value: string;
  href: string;
};

type TranslateFn = (text: string, values?: Record<string, string | number>) => string;

const compactToolbarLabels = new Set(["Workspace", "Project", "Environment"]);

export function buildAuditActiveFilterChips(
  chips: Array<AuditActiveFilterChip | null>,
) {
  return chips.filter((chip): chip is AuditActiveFilterChip => {
    if (!chip) {
      return false;
    }

    return !compactToolbarLabels.has(chip.label);
  });
}

export function buildAuditFrontSavedViewSections(args: {
  tr: TranslateFn;
  defaultViews: SavedViewBarItem[];
  recentViews: SavedViewBarItem[];
  savedViewsUnavailable: boolean;
}) {
  const sections: SavedViewBarSection[] = [
    {
      key: "default",
      title: args.tr("Default views"),
      items: args.defaultViews,
      emptyMessage: args.tr("Default audit views are unavailable right now."),
    },
  ];

  if (!args.savedViewsUnavailable && args.recentViews.length > 0) {
    sections.push({
      key: "recent",
      title: args.tr("Recent views"),
      items: args.recentViews,
      emptyMessage: args.tr("Save an audit lane once and it will appear here for repeat review."),
    });
  }

  return sections;
}

export function buildAuditResultSummaryItems(args: {
  tr: TranslateFn;
  pageStart: number;
  pageEnd: number;
  total: number;
  visibleActorCount: number;
  visibleActionCount: number;
  serviceActorCount: number;
  activeSavedViewName: string | null;
}) {
  const rangeValue = String(args.total);
  const rangeMeta = args.total === 0 ? "0" : `${args.pageStart}-${args.pageEnd}`;
  const serviceMeta = args.activeSavedViewName ?? undefined;

  return [
    {
      id: "range",
      label: args.tr("Audit events"),
      meta: rangeMeta,
      value: rangeValue,
    },
    {
      id: "actors",
      label: args.tr("Actor"),
      value: String(args.visibleActorCount),
    },
    {
      id: "actions",
      label: args.tr("Action"),
      value: String(args.visibleActionCount),
    },
    {
      id: "service-actors",
      label: args.tr("Service actors"),
      meta: serviceMeta,
      value: String(args.serviceActorCount),
    },
  ] satisfies ResourceSummaryStripItem[];
}
