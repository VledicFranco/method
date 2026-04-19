// SPDX-License-Identifier: Apache-2.0
/**
 * Operational Partition Config — capacity and accepted content types.
 *
 * PRD 044 C-2: The operational partition holds tool results, observations,
 * errors, and file content. Largest partition — operational context is the
 * most voluminous and most transient.
 */

export const OPERATIONAL_PARTITION_CONFIG = {
  id: 'operational' as const,
  capacity: 12,
  acceptedTypes: ['tool-result', 'observation', 'error', 'file-content'] as const,
};
