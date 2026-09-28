import { z } from "zod";

const modelPointSchema = z.object({
  period: z.string().trim().min(1).max(80).nullable(),
  value: z.number().finite().nullable(),
  unit: z.string().trim().max(40).nullable(),
  evidenceText: z.string().trim().max(240).nullable(),
}).strict();

const visionClaimSchema = z.object({
  claimText: z.string().trim().max(240).nullable(),
  metric: z.string().trim().max(80).nullable(),
  scope: z.string().trim().max(80).nullable(),
  claimedGrowthPercent: z.number().finite().nullable(),
  older: modelPointSchema,
  newer: modelPointSchema,
  unreadableItems: z.array(z.string().trim().min(1).max(160)).max(20),
}).strict();

const visionAxisSchema = z.object({
  label: z.string().trim().max(80).nullable(),
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
  unit: z.string().trim().max(40).nullable(),
}).strict();

const visionObservationSchema = z.object({
  claims: z.array(visionClaimSchema),
  axis: visionAxisSchema.nullable().optional(),
}).strict();

export type VisionObservation = z.infer<typeof visionObservationSchema>;

export function parseVisionObservation(value: unknown): VisionObservation {
  return visionObservationSchema.parse(value);
}
