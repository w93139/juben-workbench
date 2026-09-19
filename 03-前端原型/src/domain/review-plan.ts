import { z } from "zod";

const id = z.string().min(1).max(100);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().safe();
export const scopedStages = ["independentA", "independentB", "mutualA", "mutualB", "coordinator"] as const;
export type ScopedStage = (typeof scopedStages)[number];
export const scopedUnitId = (scopeId: string, stage: ScopedStage) => `sr-${stage}-${scopeId}`;
export const reviewPartSchema = z.object({ id, artifactId: id, start: integer, end: integer, hash }).strict();
export const reviewLinkSchema = z.object({ id, parts: z.tuple([id, id]), groups: z.array(z.string().min(1).max(120)).max(1000) }).strict();
export const reviewPlanSchema = z.object({
  version: z.literal("segmented-review/1"), blueprintHash: hash,
  artifacts: z.array(z.object({ id, hash, length: integer }).strict()).min(1).max(240),
  parts: z.array(reviewPartSchema).min(1).max(2048),
  groups: z.array(z.object({ id: z.string().min(1).max(120), parts: z.array(id).min(1).max(2048) }).strict()).max(50000),
  links: z.array(reviewLinkSchema).max(8192),
  limits: z.object({ partBytes: integer.positive(), contextBytes: integer.positive().max(600000), reportReserveBytes: integer.min(2), maxParts: integer.positive().max(2048), maxLinks: integer.positive().max(8192) }).strict(),
  callsMax: integer.positive().max(51200),
}).strict();
export type ReviewPart = z.infer<typeof reviewPartSchema>;
export type ReviewLink = z.infer<typeof reviewLinkSchema>;
export type ReviewPlan = z.infer<typeof reviewPlanSchema>;
