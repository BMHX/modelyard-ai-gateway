import type {
  SelfServeModelCatalog,
  SelfServeModelCatalogItem,
  SelfServeVirtualKeyBootstrap,
} from "@teamops/contracts";

export function getConfiguredSelfServeModelItems(
  bootstrap: SelfServeVirtualKeyBootstrap | null,
  providerConnectionId: string,
): SelfServeModelCatalogItem[] {
  return (
    bootstrap?.providerConnections.find((connection) => connection.id === providerConnectionId)
      ?.configuredModels ?? []
  );
}

export function mergeSelfServeModelCatalog(args: {
  providerConnectionId: string;
  liveCatalog: SelfServeModelCatalog | null;
  configuredItems: SelfServeModelCatalogItem[];
  fetchedAt?: string;
}): SelfServeModelCatalog | null {
  const items = new Map<string, SelfServeModelCatalogItem>();

  for (const item of args.liveCatalog?.items ?? []) {
    items.set(item.id, item);
  }

  for (const item of args.configuredItems) {
    if (items.has(item.id)) {
      continue;
    }

    items.set(item.id, item);
  }

  if (items.size === 0) {
    return null;
  }

  return {
    providerConnectionId: args.providerConnectionId,
    fetchedAt: args.liveCatalog?.fetchedAt ?? args.fetchedAt ?? new Date().toISOString(),
    items: [...items.values()],
  };
}
