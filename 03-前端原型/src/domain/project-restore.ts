import { z } from "zod";
export const restoreOriginSchema = z.object({
  operationId: z.uuid(), backupId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceProjectId: z.string().min(1).max(200), restoredAt: z.iso.datetime(),
}).strict();
