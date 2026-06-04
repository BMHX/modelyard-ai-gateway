import { z } from "zod";

export const LineageKeyVersionSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.string().optional(),
}).passthrough();

export const RotateLineageKeyVersionInputSchema = z.object({
  reason: z.string().trim().min(1).optional(),
}).passthrough();

export const IssueLineageInputSchema = z.object({
  customerId: z.string().trim().min(1),
  deploymentId: z.string().trim().min(1),
  releaseId: z.string().trim().min(1),
  manifestHash: z.string().trim().min(1),
  artifacts: z.array(z.unknown()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const LineageLookupQuerySchema = z.object({
  lineageId: z.string().trim().min(1).optional(),
  lineageToken: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  deploymentId: z.string().trim().min(1).optional(),
  releaseId: z.string().trim().min(1).optional(),
  manifestHash: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).passthrough();

export const LineageIssuanceSchema = z.object({
  lineageId: z.string(),
  lineageToken: z.string().nullable().default(null),
}).passthrough();

export const LineageListResponseSchema = z.object({
  items: z.array(LineageIssuanceSchema).default([]),
  total: z.number().int().min(0).default(0),
}).passthrough();

export const RevokeLineageInputSchema = z.object({
  reason: z.string().trim().min(1),
}).passthrough();

export const AttestationBundleSchema = z.object({
  attestationBundleId: z.string(),
  lineageId: z.string(),
}).passthrough();

export const BuildDescriptorResponseSchema = z.object({
  lineageId: z.string(),
}).passthrough();

export const VerifyLineageArtifactsInputSchema = z.object({
  artifacts: z.array(z.unknown()).default([]),
}).passthrough();

export const VerifyLineageArtifactsResponseSchema = z.object({
  verified: z.boolean().default(false),
}).passthrough();

export const FingerprintLookupQuerySchema = LineageLookupQuerySchema;
export const FingerprintKeyVersionListQuerySchema = z.object({}).passthrough();
export const LineageKeyVersionListQuerySchema = FingerprintKeyVersionListQuerySchema;
export const IssueFingerprintInputSchema = IssueLineageInputSchema;
export const RevokeFingerprintInputSchema = RevokeLineageInputSchema;
export const RotateFingerprintKeyVersionInputSchema = RotateLineageKeyVersionInputSchema;

export type LineageKeyVersion = z.infer<typeof LineageKeyVersionSchema>;
export type RotateLineageKeyVersionInput = z.infer<typeof RotateLineageKeyVersionInputSchema>;
export type IssueLineageInput = z.infer<typeof IssueLineageInputSchema>;
export type LineageLookupQuery = z.infer<typeof LineageLookupQuerySchema>;
export type LineageIssuance = z.infer<typeof LineageIssuanceSchema>;
export type LineageListResponse = z.infer<typeof LineageListResponseSchema>;
export type RevokeLineageInput = z.infer<typeof RevokeLineageInputSchema>;
export type AttestationBundle = z.infer<typeof AttestationBundleSchema>;
export type BuildDescriptorResponse = z.infer<typeof BuildDescriptorResponseSchema>;
export type VerifyLineageArtifactsInput = z.infer<typeof VerifyLineageArtifactsInputSchema>;
export type VerifyLineageArtifactsResponse = z.infer<typeof VerifyLineageArtifactsResponseSchema>;
