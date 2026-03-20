/**
 * PRD 018: Event Triggers — Startup Scanning (Phase 2a-1)
 *
 * On bridge startup, scans .method/strategies/*.yaml for Strategy files
 * with event triggers and registers them with the TriggerRouter.
 *
 * Per-file error isolation: malformed YAML, invalid triggers, or
 * unresolvable paths are logged as warnings and skipped. The bridge
 * starts successfully even if some strategies fail to register.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TriggerRouter } from './trigger-router.js';
import { hasEventTriggers } from './trigger-parser.js';

export interface ScanResult {
  scanned: number;
  registered: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Scan a directory for Strategy YAML files and register their triggers.
 *
 * @param router - The TriggerRouter instance to register triggers with
 * @param strategyDir - Path to the strategies directory
 * @param logger - Optional logger for warnings/errors
 * @returns Scan results with counts and any errors
 */
export async function scanAndRegisterTriggers(
  router: TriggerRouter,
  strategyDir: string,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<ScanResult> {
  const log = logger ?? {
    info: (msg: string) => console.log(`[triggers:scan] ${msg}`),
    warn: (msg: string) => console.warn(`[triggers:scan] ${msg}`),
    error: (msg: string) => console.error(`[triggers:scan] ${msg}`),
  };

  const resolvedDir = resolve(strategyDir);
  const result: ScanResult = {
    scanned: 0,
    registered: 0,
    skipped: 0,
    errors: [],
  };

  // Check if directory exists
  if (!existsSync(resolvedDir)) {
    log.warn(`Strategy directory not found: ${resolvedDir}`);
    return result;
  }

  // Read directory contents
  let files: string[];
  try {
    files = readdirSync(resolvedDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
    );
  } catch (err) {
    log.error(`Failed to read strategy directory ${resolvedDir}: ${(err as Error).message}`);
    return result;
  }

  log.info(`Scanning ${files.length} strategy file(s) in ${resolvedDir}`);

  for (const file of files) {
    result.scanned++;
    const filePath = join(resolvedDir, file);

    try {
      // Quick check: does this file have any event triggers?
      const content = readFileSync(filePath, 'utf-8');
      if (!hasEventTriggers(content)) {
        result.skipped++;
        continue;
      }

      // Register triggers
      const registrations = await router.registerStrategy(filePath);
      if (registrations.length > 0) {
        result.registered += registrations.length;
        log.info(`  ${file}: ${registrations.length} trigger(s) registered`);
      } else {
        result.skipped++;
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      result.errors.push({ file, error: errorMsg });
      log.warn(`  ${file}: failed to register — ${errorMsg}`);
    }
  }

  log.info(
    `Scan complete: ${result.scanned} scanned, ${result.registered} registered, ` +
    `${result.skipped} skipped, ${result.errors.length} error(s)`,
  );

  return result;
}
