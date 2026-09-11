import { z } from "zod";

// Only the fields the Workspace page actually consumes are validated here —
// the full contract lives in ../../../format/SPEC.md and is enforced
// server-side by the processing service's response_model.
export const paletteEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  colorHex: z.string(),
});

export const projectSummarySchema = z.object({
  schemaVersion: z.string(),
  palette: z.array(paletteEntrySchema).min(2).max(8),
  regions: z.array(z.unknown()),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;
