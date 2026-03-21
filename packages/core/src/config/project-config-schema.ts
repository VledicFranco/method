/**
 * Project Configuration Schema & Validation
 *
 * F-THANE-2 / F-PRAGMA-4: JSON Schema for project-config.yaml
 *
 * Each project must have a .method/project-config.yaml file with:
 * - Required: id (unique identifier)
 * - Required: name (human-readable name)
 * - Optional: description, owner, version, dependencies, shared_with
 *
 * Validated on:
 * - Discovery: when .method/project-config.yaml is first found
 * - Startup: on bridge initialization
 * - Reload: POST /api/projects/:id/reload
 */

import { z } from 'zod';

/**
 * Project configuration schema
 * Enforces required and optional fields, type checking, and basic validation
 */
export const ProjectConfigSchema = z.object({
  // Required fields
  id: z.string()
    .min(1, 'Project id is required')
    .regex(/^[a-z0-9\-_]+$/, 'Project id must contain only lowercase letters, numbers, hyphens, or underscores'),

  name: z.string()
    .min(1, 'Project name is required')
    .max(200, 'Project name must be 200 characters or less'),

  // Optional fields
  description: z.string()
    .max(500, 'Description must be 500 characters or less')
    .optional(),

  owner: z.string()
    .max(100, 'Owner must be 100 characters or less')
    .optional(),

  version: z.string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (e.g., 1.0.0)')
    .optional(),

  dependencies: z.array(
    z.object({
      project_id: z.string(),
      version_constraint: z.string().optional(),
    })
  )
    .optional(),

  shared_with: z.array(z.string())
    .optional(),

  genesis_enabled: z.boolean()
    .optional(),

  resource_copy: z.boolean()
    .optional(),

  genesis_budget: z.number()
    .optional(),
}).passthrough(); // Allow additional properties (Phase 2 genesis fields)

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * Validate a project configuration object
 * Throws ZodError on validation failure
 *
 * @param config - Raw configuration object
 * @returns Validated ProjectConfig
 * @throws ZodError if validation fails
 */
export function validateProjectConfig(config: unknown): ProjectConfig {
  return ProjectConfigSchema.parse(config);
}

/**
 * Validate and provide detailed error messages
 * Returns validation result with errors array instead of throwing
 *
 * @param config - Raw configuration object
 * @returns { valid: boolean, data?: ProjectConfig, errors?: string[] }
 */
export function validateProjectConfigSafe(
  config: unknown,
): { valid: boolean; data?: ProjectConfig; errors?: string[] } {
  const result = ProjectConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors = (result.error.errors || []).map((err) => {
    const path = err.path.length > 0 ? err.path.join('.') : 'root';
    return `${path}: ${err.message}`;
  });

  return { valid: false, errors };
}

/**
 * JSON Schema representation (for API documentation)
 * Can be used to validate configs in clients or external tools
 */
export const ProjectConfigJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: {
      type: 'string',
      description: 'Unique project identifier (lowercase, hyphens/underscores only)',
      pattern: '^[a-z0-9\\-_]+$',
      minLength: 1,
    },
    name: {
      type: 'string',
      description: 'Human-readable project name',
      minLength: 1,
      maxLength: 200,
    },
    description: {
      type: 'string',
      description: 'Project description',
      maxLength: 500,
    },
    owner: {
      type: 'string',
      description: 'Project owner (email or name)',
      maxLength: 100,
    },
    version: {
      type: 'string',
      description: 'Project version (semantic versioning)',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
    },
    dependencies: {
      type: 'array',
      description: 'List of project dependencies',
      items: {
        type: 'object',
        required: ['project_id'],
        properties: {
          project_id: {
            type: 'string',
            description: 'ID of the dependent project',
          },
          version_constraint: {
            type: 'string',
            description: 'Version constraint (e.g., "^1.0.0")',
          },
        },
      },
    },
    shared_with: {
      type: 'array',
      description: 'List of entities this project is shared with',
      items: {
        type: 'string',
      },
    },
    genesis_enabled: {
      type: 'boolean',
      description: 'Enable Genesis agent for this project (Phase 2)',
    },
    resource_copy: {
      type: 'boolean',
      description: 'Allow copying resources to/from this project',
    },
    genesis_budget: {
      type: 'number',
      description: 'Daily token budget for Genesis agent (Phase 2)',
    },
  },
  additionalProperties: true,
};
