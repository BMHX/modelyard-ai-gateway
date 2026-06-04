import { Download, FileBadge2, KeyRound, Search, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  fetchAuthSession,
  getLineage,
  getLineageBuildDescriptor,
  listLineageAttestationBundles,
  listLineageKeyVersions,
  listOrganizationSummaries,
  lookupLineageIssuances,
} from "../lib/control-api";
import { getCurrentLocale } from "../lib/i18n-server";
import { translateInlineText } from "../lib/i18n";
import {
  refreshBuildDescriptorAction,
  issueLineageAction,
  revokeLineageAction,
  rotateLineageKeyVersionAction,
  verifyLineageArtifactsAction,
} from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const rawValue = searchParams[key];
  if (Array.isArray(rawValue)) {
    return rawValue[0]?.trim() || null;
  }

  return typeof rawValue === "string" ? rawValue.trim() || null : null;
}

function hasLookupFilters(searchParams: Record<string, string | string[] | undefined>) {
  return Boolean(
    getSingleSearchParam(searchParams, "lineageId") ||
      getSingleSearchParam(searchParams, "lineageToken") ||
      getSingleSearchParam(searchParams, "customerId") ||
      getSingleSearchParam(searchParams, "deploymentId") ||
      getSingleSearchParam(searchParams, "releaseId") ||
      getSingleSearchParam(searchParams, "manifestHash"),
  );
}

function serializePath(
  searchParams: Record<string, string | string[] | undefined>,
  nextParams: Record<string, string | null | undefined> = {},
) {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams)) {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (!value) {
      continue;
    }

    params.set(key, value);
  }

  for (const [key, value] of Object.entries(nextParams)) {
    if (!value) {
      params.delete(key);
      continue;
    }

    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/release-lineage?${query}` : "/release-lineage";
}

function renderNotice(args: {
  message: string | null;
  notice: string | null;
}) {
  if (!args.message) {
    return null;
  }

  const isError = args.notice === "error";

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        isError
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      {args.message}
    </div>
  );
}

function renderJsonBlock(value: unknown) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-[12px] leading-5 text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function ReleaseLineagePage({ searchParams }: PageProps) {
  const locale = await getCurrentLocale();
  const tr = (text: string) => translateInlineText(locale, text);
  const resolvedSearchParams = (await searchParams) ?? {};
  const currentPath = serializePath(resolvedSearchParams);
  const notice = getSingleSearchParam(resolvedSearchParams, "notice");
  const message = getSingleSearchParam(resolvedSearchParams, "message");
  const selectedLineageId =
    getSingleSearchParam(resolvedSearchParams, "selectedLineageId") ??
    getSingleSearchParam(resolvedSearchParams, "lineageId");

  const [session, organizations, keyVersions] = await Promise.all([
    fetchAuthSession().catch(() => null),
    listOrganizationSummaries().catch(() => []),
    listLineageKeyVersions().catch(() => []),
  ]);

  let lookupResults: Awaited<ReturnType<typeof lookupLineageIssuances>> = {
    items: [],
    total: 0,
  };
  let lookupError: string | null = null;

  if (hasLookupFilters(resolvedSearchParams)) {
    try {
      lookupResults = await lookupLineageIssuances({
        lineageId: getSingleSearchParam(resolvedSearchParams, "lineageId") ?? undefined,
        lineageToken: getSingleSearchParam(resolvedSearchParams, "lineageToken") ?? undefined,
        customerId: getSingleSearchParam(resolvedSearchParams, "customerId") ?? undefined,
        deploymentId: getSingleSearchParam(resolvedSearchParams, "deploymentId") ?? undefined,
        releaseId: getSingleSearchParam(resolvedSearchParams, "releaseId") ?? undefined,
        manifestHash: getSingleSearchParam(resolvedSearchParams, "manifestHash") ?? undefined,
        limit: 25,
        offset: 0,
      });
    } catch (error) {
      lookupError = tr("Can't load release lineage right now.");
    }
  }

  const activeLineageId = selectedLineageId ?? lookupResults.items[0]?.lineageId ?? null;
  const selectedLineage = activeLineageId ? await getLineage(activeLineageId).catch(() => null) : null;
  const buildDescriptor = activeLineageId
    ? await getLineageBuildDescriptor(activeLineageId).then((result) => result.buildDescriptor).catch(() => null)
    : null;
  const attestationBundles = activeLineageId
    ? await listLineageAttestationBundles(activeLineageId).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <ShieldCheck className="size-4" />
          <span>Internal verification</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Release Lineage</h1>
          <p className="max-w-[72ch] text-sm text-muted-foreground">
            Issue signed release lineage, rotate attestation keys, inspect release manifests, and review
            attestation bundles without leaving the control plane.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/60 px-2.5 py-1">
            Auth session: {session ? session.email : "bootstrap or unavailable"}
          </span>
          {session ? (
            <span className="rounded-full border border-border/60 px-2.5 py-1">
              Organization: {session.organizationSlug}
            </span>
          ) : null}
          <span className="rounded-full border border-border/60 px-2.5 py-1">
            Organizations: {organizations.length}
          </span>
          <span className="rounded-full border border-border/60 px-2.5 py-1">
            Active keys: {keyVersions.filter((item) => item.status === "active").length}
          </span>
        </div>
      </div>

      {renderNotice({ message, notice })}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border/60 bg-background px-5 py-5">
          <div className="mb-4 space-y-1">
            <h2 className="text-base font-semibold text-foreground">Issue release lineage</h2>
            <p className="text-sm text-muted-foreground">
              Create a signed release record with deployment metadata, manifest context, and artifact attestations.
            </p>
          </div>
          <form action={issueLineageAction} className="grid gap-3">
            <input name="redirectPath" type="hidden" value={currentPath} />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Organization</span>
                <select
                  className="flex h-[36px] w-full rounded-[10px] border border-border/70 bg-background px-3 text-[13px]"
                  defaultValue={session?.organizationId ?? organizations[0]?.id ?? ""}
                  name="organizationId"
                  required
                >
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Deployment mode</span>
                <select
                  className="flex h-[36px] w-full rounded-[10px] border border-border/70 bg-background px-3 text-[13px]"
                  defaultValue="self_host_preview"
                  name="deploymentMode"
                >
                  <option value="cloud">Cloud</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="self_host_preview">Self-host Preview</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Deployment name</span>
                <Input defaultValue="Preview Runtime" name="deploymentName" required />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Channel</span>
                <Input defaultValue="self-host" name="channel" required />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Version</span>
                <Input defaultValue="0.1.0" name="version" required />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Build system</span>
                <Input defaultValue="monorepo" name="buildSystem" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Deployment ID</span>
                <Input name="deploymentId" placeholder="Optional opaque deployment id" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Release ID</span>
                <Input name="releaseId" placeholder="Optional opaque release id" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Region</span>
                <Input name="region" placeholder="cn-east-1" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-foreground">Install channel</span>
                <Input name="installChannel" placeholder="preview-runtime" />
              </label>
              <label className="grid gap-1.5 text-sm md:col-span-2">
                <span className="font-medium text-foreground">Git commit SHA</span>
                <Input name="gitCommitSha" placeholder="Optional git commit sha" />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">Artifact manifest JSON</span>
              <textarea
                className="min-h-28 rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[12px]"
                defaultValue={JSON.stringify({ releaseSurface: "preview-runtime" }, null, 2)}
                name="artifactManifestJson"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">Artifact attestations JSON</span>
              <textarea
                className="min-h-32 rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[12px]"
                defaultValue={JSON.stringify(
                  [
                    {
                      artifactRole: "runtime-image",
                      relativePath: "infra/Dockerfile.runtime",
                      objectKey: null,
                      sha256: "replace-with-real-sha256",
                      sizeBytes: null,
                      embedLocator: {},
                    },
                  ],
                  null,
                  2,
                )}
                name="artifactsJson"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-foreground">Metadata JSON</span>
              <textarea
                className="min-h-24 rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[12px]"
                defaultValue={JSON.stringify({ source: "web-admin" }, null, 2)}
                name="metadataJson"
              />
            </label>
            <div className="flex justify-end">
              <Button type="submit">Issue release lineage</Button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background px-5 py-5">
          <div className="mb-4 space-y-1">
            <h2 className="text-base font-semibold text-foreground">Key versions</h2>
            <p className="text-sm text-muted-foreground">
              Rotate HMAC and signing keys used for lineage statements and attestation bundles.
            </p>
          </div>
          <div className="space-y-3">
            {keyVersions.length ? (
              keyVersions.map((keyVersion) => (
                <div key={keyVersion.keyId} className="rounded-xl border border-border/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{keyVersion.keyId}</p>
                      <p className="text-xs text-muted-foreground">
                        {keyVersion.purpose} · {keyVersion.algorithm} · {keyVersion.status}
                      </p>
                    </div>
                    <form action={rotateLineageKeyVersionAction}>
                      <input name="redirectPath" type="hidden" value={currentPath} />
                      <input name="purpose" type="hidden" value={keyVersion.purpose} />
                      <Button size="sm" type="submit" variant="outline">
                        Rotate
                      </Button>
                    </form>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                compact
                description="No lineage keys are available yet."
                title="No keys"
              />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-background px-5 py-5">
        <div className="mb-4 space-y-1">
          <h2 className="text-base font-semibold text-foreground">Lookup release lineage</h2>
          <p className="text-sm text-muted-foreground">
            Find official releases by lineage token, deployment, release, customer, or manifest hash.
          </p>
        </div>
        <form action="/release-lineage" className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Lineage ID</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "lineageId") ?? ""} name="lineageId" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Lineage token</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "lineageToken") ?? ""} name="lineageToken" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Customer ID</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "customerId") ?? ""} name="customerId" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Deployment ID</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "deploymentId") ?? ""} name="deploymentId" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Release ID</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "releaseId") ?? ""} name="releaseId" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Manifest hash</span>
            <Input defaultValue={getSingleSearchParam(resolvedSearchParams, "manifestHash") ?? ""} name="manifestHash" />
          </label>
          <div className="md:col-span-3 flex justify-end gap-2">
            <Button asChild type="button" variant="ghost">
              <a href="/release-lineage">Reset</a>
            </Button>
            <Button type="submit" variant="outline">
              <Search className="mr-2 size-4" />
              Lookup
            </Button>
          </div>
        </form>

        <div className="mt-5">
          {lookupError ? (
            <EmptyState compact description={lookupError} title="Lookup unavailable" />
          ) : lookupResults.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lineage</TableHead>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Release</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manifest</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lookupResults.items.map((item) => (
                  <TableRow key={item.lineageId}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{item.lineageId}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{item.lineageToken}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{item.deployment?.deploymentName ?? item.deploymentId}</p>
                        <p className="text-xs text-muted-foreground">{item.customerId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p>{item.release?.version ?? item.releaseId}</p>
                        <p className="text-xs text-muted-foreground">{item.releaseId}</p>
                      </div>
                    </TableCell>
                    <TableCell>{item.status}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{item.manifestHash}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={serializePath(resolvedSearchParams, {
                              selectedLineageId: item.lineageId,
                              lineageId: item.lineageId,
                            })}
                          >
                            Inspect
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              compact
              description="Run a lookup above to inspect issued release lineage and attestation bundles."
              title="No lineage loaded"
            />
          )}
        </div>
      </section>

      {selectedLineage ? (
        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border/60 bg-background px-5 py-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Selected release lineage</h2>
                <p className="text-sm text-muted-foreground">
                  Inspect the manifest, artifact attestations, and issuance metadata for the currently selected release.
                </p>
              </div>
              <form action={revokeLineageAction} className="flex items-end gap-2">
                <input name="redirectPath" type="hidden" value={currentPath} />
                <input name="lineageId" type="hidden" value={selectedLineage.lineageId} />
                <Input name="reason" placeholder="Revocation reason" required />
                <Button size="sm" type="submit" variant="destructive">
                  Revoke
                </Button>
              </form>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Lineage</p>
                <p className="mt-1 font-medium text-foreground">{selectedLineage.lineageId}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{selectedLineage.lineageToken}</p>
              </div>
              <div className="rounded-xl border border-border/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Attestation bundle</p>
                <p className="mt-1 font-medium text-foreground">{selectedLineage.attestationBundleId}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {selectedLineage.attestationRootHash}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Deployment</p>
                <p className="mt-1 font-medium text-foreground">
                  {selectedLineage.deployment?.deploymentName ?? selectedLineage.deploymentId}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{selectedLineage.deploymentId}</p>
              </div>
              <div className="rounded-xl border border-border/60 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Release</p>
                <p className="mt-1 font-medium text-foreground">
                  {selectedLineage.release?.version ?? selectedLineage.releaseId}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{selectedLineage.releaseId}</p>
              </div>
              <div className="rounded-xl border border-border/60 px-4 py-3 md:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Build descriptor</p>
                    <p className="mt-1 font-medium text-foreground">
                      {buildDescriptor ? "Available for official build orchestration" : "Not loaded"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use this descriptor as the official input to watermarked build and artifact verification.
                    </p>
                  </div>
                  <form action={refreshBuildDescriptorAction}>
                    <input name="redirectPath" type="hidden" value={currentPath} />
                    <input name="lineageId" type="hidden" value={selectedLineage.lineageId} />
                    <Button size="sm" type="submit" variant="outline">
                      Refresh descriptor
                    </Button>
                  </form>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <KeyRound className="size-4" />
                  <span>Official build descriptor</span>
                </div>
                {buildDescriptor ? (
                  renderJsonBlock(buildDescriptor)
                ) : (
                  <EmptyState
                    compact
                    description="Load the build descriptor to hand the official release context to CI or a local verifier."
                    title="Descriptor unavailable"
                  />
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileBadge2 className="size-4" />
                  <span>Release manifest</span>
                </div>
                {renderJsonBlock(selectedLineage.release?.artifactManifest ?? {})}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="size-4" />
                  <span>Artifact attestations</span>
                </div>
                {selectedLineage.artifactAttestations.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Role</TableHead>
                        <TableHead>Relative path</TableHead>
                        <TableHead>SHA256</TableHead>
                        <TableHead>Verification</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLineage.artifactAttestations.map((artifact) => (
                        <TableRow key={`${artifact.artifactRole}:${artifact.relativePath}`}>
                          <TableCell>{artifact.artifactRole}</TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {artifact.relativePath}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {artifact.sha256}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {artifact.verificationStatus}
                            {artifact.buildLocator ? (
                              <p className="mt-1 font-mono text-[11px]">{artifact.buildLocator}</p>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    compact
                    description="No artifact attestations are attached to this release lineage yet."
                    title="No artifact attestations"
                  />
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="size-4" />
                  <span>Artifact verification</span>
                </div>
                <form action={verifyLineageArtifactsAction} className="grid gap-3">
                  <input name="redirectPath" type="hidden" value={currentPath} />
                  <input name="lineageId" type="hidden" value={selectedLineage.lineageId} />
                  <textarea
                    className="min-h-32 rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-[12px]"
                    defaultValue={JSON.stringify(
                      {
                        observedArtifacts: selectedLineage.artifactAttestations.map((artifact) => ({
                          artifactRole: artifact.artifactRole,
                          relativePath: artifact.relativePath,
                          sha256: artifact.sha256,
                          sizeBytes: artifact.sizeBytes,
                          buildLocator: artifact.buildLocator,
                          codewordDigest: artifact.codewordDigest,
                          candidateCount: artifact.candidateCount,
                          assignmentCount: artifact.assignmentCount,
                          familySummary: artifact.familySummary,
                        })),
                        recoveredLocator: selectedLineage.artifactAttestations[0]?.buildLocator ?? null,
                        locatorCandidates: selectedLineage.artifactAttestations
                          .map((artifact) => artifact.buildLocator)
                          .filter((value): value is string => Boolean(value)),
                        codewordDigest: selectedLineage.artifactAttestations[0]?.codewordDigest ?? null,
                        digestCandidates: selectedLineage.artifactAttestations
                          .map((artifact) => artifact.codewordDigest)
                          .filter((value): value is string => Boolean(value)),
                        familyHitSummary: selectedLineage.artifactAttestations.flatMap((artifact) => artifact.familySummary),
                        matchStatus: "partial",
                      },
                      null,
                      2,
                    )}
                    name="extractorJson"
                  />
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline">
                      Verify artifacts
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background px-5 py-5">
            <div className="mb-4 space-y-1">
              <h2 className="text-base font-semibold text-foreground">Attestation bundles</h2>
              <p className="text-sm text-muted-foreground">
                Review generated attestation bundles and download the canonical JSON envelope for offline verification.
              </p>
            </div>
            {attestationBundles.length ? (
              <div className="space-y-3">
                {attestationBundles.map((bundle) => (
                  <div key={bundle.attestationBundleId} className="rounded-xl border border-border/60 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{bundle.attestationBundleId}</p>
                        <p className="text-xs text-muted-foreground">
                          {bundle.bundleKind} · {bundle.generatedAt}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">{bundle.contentSha256}</p>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <a href={`/release-lineage/attestation-bundles/${bundle.attestationBundleId}/download`}>
                          <Download className="mr-2 size-4" />
                          Download
                        </a>
                      </Button>
                    </div>
                    {bundle.metadata ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          Inspect bundle metadata
                        </summary>
                        <div className="mt-3">{renderJsonBlock(bundle.metadata)}</div>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                description="No attestation bundles are linked to the selected release lineage."
                title="No attestation bundles"
              />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
