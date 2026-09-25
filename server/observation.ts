import { z } from "zod";

const modelPointSchema = z.object({
  period: z.string().trim().min(1).max(80).nullable(),
  value: z.number().finite().nullable(),
  unit: z.string().trim().max(40).nullable(),
  evidenceText: z.string().trim().max(240).nullable(),
}).strict();

const visionObservationSchema = z.object({
  titleOriginal: z.string().trim().max(240).nullable(),
  claimedGrowthPercent: z.number().finite().nullable(),
  older: modelPointSchema,
  newer: modelPointSchema,
  unreadableItems: z.array(z.string().trim().min(1).max(160)).max(20),
}).strict();

export type VisionObservation = z.infer<typeof visionObservationSchema>;

export function parseVisionObservation(value: unknown): VisionObservation {
  return visionObservationSchema.parse(value);
}
