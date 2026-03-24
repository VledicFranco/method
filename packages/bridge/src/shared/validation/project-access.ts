/**
 * Cross-domain project access validation utilities.
 *
 * Extracted from projects/routes.ts (MG-5) so that both projects and genesis
 * domains can import these without cross-domain coupling.
 */

import type { FastifyRequest } from 'fastify';

export interface SessionContext {
  projectId?: string;
  isAdmin?: boolean;
}

export function getSessionContext(req: FastifyRequest): SessionContext {
  // In Phase 1, extract from headers or query params
  // Will be replaced with proper session middleware in Phase 2
  // NOTE: x-admin header removed (F-SECUR-002). Admin checks require cryptographic session binding.
  const projectId = (req.headers['x-project-id'] as string) || undefined;
  return { projectId };
}

export function validateProjectAccess(
  requestedProjectId: string,
  sessionContext: SessionContext,
): { allowed: boolean; reason?: string } {
  // Sessions must match project_id (F-SECUR-002: removed header-based admin escalation)
  if (sessionContext.projectId && sessionContext.projectId !== requestedProjectId) {
    return {
      allowed: false,
      reason: `Access denied: project ${requestedProjectId} not accessible to session project ${sessionContext.projectId}`,
    };
  }

  // If no project context, deny write operations (Phase 1: discovery-only, no writes)
  if (!sessionContext.projectId) {
    return { allowed: true }; // Read-only discovery access
  }

  return { allowed: true };
}
