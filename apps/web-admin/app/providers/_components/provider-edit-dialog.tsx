"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

import {
  type ProviderConnection,
  type ProviderConnectionModelCatalog,
  type ProviderModelConfig,
  type ProviderPricingConfig,
} from "@teamops/contracts";

import { ResourceCreateDialog } from "../../components/resource-create-dialog";
import { ResourceInlineNotice } from "../../components/resource-inline-notice";
import {
  fetchProviderConnectionModelCatalog,
} from "@/app/lib/console-api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/app/lib/i18n-client";

import { ProviderPricingEditor } from "./provider-pricing-editor";
import { ProviderModelManager } from "./provider-model-manager";
import {
  buildProviderModelConfigFromMetadata,
  createProviderModelConfig,
  getLegacyModelIdsFromMetadata,
} from "../provider-model-config";
import {
  getProviderCatalogCredentialIssue,
  getProviderCatalogCredentialIssueCopy,
} from "../provider-catalog-health";
import { getPresetModelsForProvider } from "../provider-model-registry";

type ProviderEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  connection: ProviderConnection | null;
  operationsMode: "basic" | "advanced";
  isUpdatePending: boolean;
  locale: string;
  catalogRefreshNonce?: number;
  onUpdate: (event: FormEvent<HTMLFormElement>, connection: ProviderConnection) => void;
  updateErrorMessage?: string | null;
  getProviderKindLabel: (provider: ProviderConnection["provider"], tr: (key: string) => string) => string;
  getPreferredMetadataValue: (metadata: Record<string, string>, keys: string[]) => string;
  getDefaultPricingConfig: (
    provider: ProviderConnection["provider"],
    pricingConfig: ProviderPricingConfig | null,
  ) => ProviderPricingConfig;
};

function getDefaultRoutingValue(connection: ProviderConnection) {
  const marker = connection.metadata.defaultForProtocol?.trim().toLowerCase();
  if (!marker) {
    return "none" as const;
  }

  if (marker === "all" || marker === "default") {
    return "all" as const;
  }

  if (connection.provider === "anthropic") {
    return marker === "anthropic" || marker === "messages" ? "provider" : "none";
  }

  return marker === "openai" || marker === "openai-compatible" || marker === "chat-completions"
    ? "provider"
    : "none";
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <label
        className="ml-0.5 text-[13px] font-bold tracking-tight text-foreground/80"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function ProviderEditDialog({
  open,
  onOpenChange,
  connection,
  operationsMode,
  isUpdatePending,
  locale,
  catalogRefreshNonce = 0,
  onUpdate,
  updateErrorMessage,
  getProviderKindLabel,
  getPreferredMetadataValue,
  getDefaultPricingConfig,
}: ProviderEditDialogProps) {
  const tr = useT("providers");
  const activeConnection = connection;
  const presetModels = useMemo(
    () => (activeConnection ? getPresetModelsForProvider(activeConnection.provider) : []),
    [activeConnection],
  );
  const presetModelIds = useMemo(
    () => new Set(presetModels.map((item) => item.id)),
    [presetModels],
  );
  const [modelConfig, setModelConfig] = useState<ProviderModelConfig>(
    createProviderModelConfig([]),
  );
  const [legacyModelIds, setLegacyModelIds] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<ProviderConnectionModelCatalog | null>(null);
  const [isCatalogPending, setIsCatalogPending] = useState(false);
  const [newApiKeyDraft, setNewApiKeyDraft] = useState("");

  useEffect(() => {
    if (!activeConnection) {
      setModelConfig(createProviderModelConfig([]));
      setLegacyModelIds(new Set());
      setCatalog(null);
      return;
    }

    setModelConfig(
      buildProviderModelConfigFromMetadata(activeConnection.metadata, presetModelIds),
    );
    setLegacyModelIds(
      getLegacyModelIdsFromMetadata(activeConnection.metadata, presetModelIds),
    );
    setCatalog(null);
    setNewApiKeyDraft("");
  }, [activeConnection, presetModelIds]);

  async function handleLoadCatalog() {
    if (!activeConnection) {
      return;
    }

    const currentConnection = activeConnection;
    setIsCatalogPending(true);

    try {
      const result = await fetchProviderConnectionModelCatalog({
        workspaceId: currentConnection.workspaceId,
        providerConnectionId: currentConnection.id,
      });
      setCatalog(result);
    } catch (error) {
      setCatalog({
        providerConnectionId: currentConnection.id,
        fetchedAt: new Date().toISOString(),
        status: "error",
        errorCode: null,
        message: error instanceof Error ? error.message : tr("modelManager.catalogError"),
        items: [],
      });
    } finally {
      setIsCatalogPending(false);
    }
  }

  useEffect(() => {
    if (!activeConnection || !open || !catalogRefreshNonce) {
      return;
    }

    void handleLoadCatalog();
  }, [activeConnection, catalogRefreshNonce, open]);

  if (!activeConnection) {
    return null;
  }

  const catalogDisabledReason =
    activeConnection.status === "revoked"
      ? tr("modelManager.catalogRevoked")
      : null;
  const credentialIssue = getProviderCatalogCredentialIssue(catalog);
  const credentialIssueCopy = credentialIssue
    ? getProviderCatalogCredentialIssueCopy(locale, credentialIssue)
    : null;
  const requiresCredentialRecovery = credentialIssue !== null;
  const canSubmit = !isUpdatePending && (!requiresCredentialRecovery || newApiKeyDraft.trim().length > 0);

  return (
    <ResourceCreateDialog
      bodyClassName="space-y-5"
      description={getProviderKindLabel(activeConnection.provider, tr)}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={activeConnection.label}
    >
      {updateErrorMessage ? (
        <ResourceInlineNotice
          label={tr("details.settingsTitle")}
          message={updateErrorMessage}
          tone="error"
        />
      ) : null}

      <form className="grid gap-5" onSubmit={(event) => onUpdate(event, activeConnection)}>
        <input
          name="credentialRecoveryRequired"
          type="hidden"
          value={requiresCredentialRecovery ? "true" : "false"}
        />
        <input
          name="defaultForProtocol"
          type="hidden"
          value={getDefaultRoutingValue(activeConnection)}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <FormField htmlFor={`provider-label-${activeConnection.id}`} label={tr("Label")}>
            <Input defaultValue={activeConnection.label} id={`provider-label-${activeConnection.id}`} name="label" required />
          </FormField>

          <div className="xl:col-span-2">
            <FormField htmlFor={`provider-base-url-${activeConnection.id}`} label={tr("Base URL")}>
              <Input
                defaultValue={activeConnection.baseUrl ?? ""}
                id={`provider-base-url-${activeConnection.id}`}
                name="baseUrl"
                placeholder={activeConnection.provider === "openai-compatible" ? tr("Required") : tr("Optional")}
              />
            </FormField>
          </div>
        </div>

        {activeConnection.provider === "anthropic" ? (
          <FormField htmlFor={`provider-anthropic-version-${activeConnection.id}`} label={tr("details.anthropicVersion")}>
            <Input
              defaultValue={activeConnection.anthropicVersion ?? "2023-06-01"}
              id={`provider-anthropic-version-${activeConnection.id}`}
              name="anthropicVersion"
            />
          </FormField>
        ) : null}

        {credentialIssueCopy ? (
          <ResourceInlineNotice
            label={credentialIssueCopy.title}
            message={credentialIssueCopy.message}
            tone="error"
          />
        ) : null}

        <ProviderModelManager
          canLoadCatalog={activeConnection.status !== "revoked"}
          catalog={catalog}
          catalogDisabledReason={catalogDisabledReason}
          hiddenInputName="modelConfigJson"
          isCatalogLoading={isCatalogPending}
          legacyModelIds={legacyModelIds}
          onChange={setModelConfig}
          onLoadCatalog={handleLoadCatalog}
          presetModels={presetModels}
          value={modelConfig}
        />

        {operationsMode === "advanced" ? (
          <div className="grid gap-4 xl:grid-cols-3">
            <FormField htmlFor={`provider-model-prefixes-${activeConnection.id}`} label={tr("modelManager.prefixesLabel")}>
              <Input
                defaultValue={getPreferredMetadataValue(activeConnection.metadata, [
                  "modelPrefixes",
                  "defaultModelPrefixes",
                  "routing.modelPrefixes",
                ])}
                id={`provider-model-prefixes-${activeConnection.id}`}
                name="modelPrefixes"
                placeholder={tr("qwen-, deepseek-")}
              />
            </FormField>

            <div className="xl:col-span-3">
              {credentialIssueCopy ? (
                <div className="mb-4">
                  <ResourceInlineNotice
                    label={tr("details.rotateApiKey")}
                    message={credentialIssueCopy.message}
                    tone="error"
                  />
                </div>
              ) : null}
              <FormField htmlFor={`provider-new-api-key-${activeConnection.id}`} label={tr("details.rotateApiKey")}>
                <Input
                  id={`provider-new-api-key-${activeConnection.id}`}
                  name="newApiKey"
                  onChange={(event) => setNewApiKeyDraft(event.currentTarget.value)}
                  placeholder={tr("details.keepCurrentKey")}
                  type="password"
                  value={newApiKeyDraft}
                />
              </FormField>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <ProviderPricingEditor
              locale={locale}
              initialValue={getDefaultPricingConfig(activeConnection.provider, activeConnection.pricingConfig)}
              inputName="pricingConfigJson"
              key={`edit-pricing-basic-${activeConnection.id}-${activeConnection.updatedAt}`}
              metadata={activeConnection.metadata}
              provider={activeConnection.provider}
              selectedModels={modelConfig.items}
            />
            {credentialIssueCopy ? (
              <ResourceInlineNotice
                label={tr("details.rotateApiKey")}
                message={credentialIssueCopy.message}
                tone="error"
              />
            ) : null}
            <FormField htmlFor={`provider-new-api-key-basic-${activeConnection.id}`} label={tr("details.rotateApiKey")}>
              <Input
                id={`provider-new-api-key-basic-${activeConnection.id}`}
                name="newApiKey"
                onChange={(event) => setNewApiKeyDraft(event.currentTarget.value)}
                placeholder={tr("details.keepCurrentKey")}
                type="password"
                value={newApiKeyDraft}
              />
            </FormField>
          </div>
        )}

        {operationsMode === "advanced" ? (
          <div className="grid gap-4">
            <ProviderPricingEditor
              locale={locale}
              initialValue={getDefaultPricingConfig(activeConnection.provider, activeConnection.pricingConfig)}
              inputName="pricingConfigJson"
              key={`edit-pricing-${activeConnection.id}-${activeConnection.updatedAt}`}
              metadata={activeConnection.metadata}
              provider={activeConnection.provider}
              selectedModels={modelConfig.items}
            />
            {credentialIssueCopy ? (
              <ResourceInlineNotice
                label={tr("details.rotateApiKey")}
                message={credentialIssueCopy.message}
                tone="error"
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button onClick={() => onOpenChange(false)} size="sm" type="button" variant="ghost">
            {tr("create.close")}
          </Button>
          <Button aria-busy={isUpdatePending || undefined} disabled={!canSubmit} size="sm" type="submit">
            {tr(isUpdatePending ? "table.actions.saving" : "table.actions.save")}
          </Button>
        </div>
      </form>
    </ResourceCreateDialog>
  );
}
