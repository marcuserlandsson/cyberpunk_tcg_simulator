import { z } from 'zod'
export const deckMetadataSchema = z.object({ format: z.enum(['constructed','demo']).optional(), notes: z.string().optional(), revisionId: z.string().optional(), versionLabel: z.string().optional(), updatedAt: z.string().optional() })
export const deckSnapshotSchema = z.object({ name: z.string(), legends: z.tuple([z.string(),z.string(),z.string()]), cards: z.record(z.string(), z.number().int().nonnegative()), demo: z.boolean().optional(), ...deckMetadataSchema.shape })
