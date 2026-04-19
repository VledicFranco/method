// SPDX-License-Identifier: Apache-2.0
/**
 * Shared formatting and helper utilities.
 * Extracted from dashboard-route.ts so they survive legacy UI removal.
 */

export function formatTokens(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUptime(startedAt: Date): string {
  const diffMs = Date.now() - startedAt.getTime();
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatStartedAt(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1_000);

  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function formatTimeUntil(isoString: string): string {
  const target = new Date(isoString).getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';

  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function meterClass(utilization: number): string {
  if (utilization >= 85) return 'critical';
  if (utilization >= 60) return 'warning';
  return 'healthy';
}

export function cacheRateClass(rate: number): string {
  if (rate >= 70) return 'good';
  if (rate >= 40) return 'mid';
  return 'low';
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ready': return 'status-ready';
    case 'working': return 'status-working';
    case 'waiting': return 'status-waiting';
    case 'dead': return 'status-dead';
    case 'initializing': return 'status-init';
    default: return 'status-init';
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function summarizeEventContent(content: Record<string, unknown>): string {
  if (!content || Object.keys(content).length === 0) return '';
  if (content.result) return String(content.result).substring(0, 80);
  if (content.error_message) return String(content.error_message).substring(0, 80);
  if (content.escalation_question) return String(content.escalation_question).substring(0, 80);
  if (content.description) return String(content.description).substring(0, 80);
  const firstVal = Object.values(content)[0];
  return String(firstVal).substring(0, 60);
}

export function triggerStatusClass(
  enabled: boolean,
  paused: boolean,
  errors: number,
): string {
  if (paused) return 'trigger-paused';
  if (!enabled) return 'trigger-disabled';
  if (errors > 0) return 'trigger-warning';
  return 'trigger-active';
}
