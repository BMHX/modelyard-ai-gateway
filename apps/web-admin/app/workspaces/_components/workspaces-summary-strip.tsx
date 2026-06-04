import {
  ResourceSummaryStrip,
  type ResourceSummaryStripItem,
} from "../../components/resource-summary-strip";

export type WorkspacesSummaryItem = ResourceSummaryStripItem;

type WorkspacesSummaryStripProps = {
  items: WorkspacesSummaryItem[];
};

export function WorkspacesSummaryStrip({
  items,
}: WorkspacesSummaryStripProps) {
  return <ResourceSummaryStrip items={items} />;
}
