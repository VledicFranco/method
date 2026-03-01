import { z } from 'zod';

export const InvariantSchema = z.object({
  id: z.string(),
  description: z.string(),
  hard: z.boolean(), // hard = blocks advance; soft = warning only
});

export const OutputFieldSchema = z.object({
  type: z.enum(['string', 'array', 'number', 'boolean']),
  items: z.string().optional(),           // for array fields: element type (documentation only)
  min_items: z.number().int().min(0).optional(),
  max_items: z.number().int().min(0).optional(),
  min_length: z.number().int().min(0).optional(),
  min_value: z.number().optional(),
  max_value: z.number().optional(),
  enum: z.array(z.string()).optional(),   // valid values for enum constraints
  description: z.string().optional(),
});

export const PhaseSchema = z.object({
  id: z.number().int().min(0),
  name: z.string(),
  role: z.string().nullable(),
  guidance: z.string(),
  output_schema: z.record(z.string(), OutputFieldSchema),
  invariants: z.array(InvariantSchema),
});

export const MethodologySchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  phases: z.array(PhaseSchema),
});

export type Invariant = z.infer<typeof InvariantSchema>;
export type OutputField = z.infer<typeof OutputFieldSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Methodology = z.infer<typeof MethodologySchema>;
