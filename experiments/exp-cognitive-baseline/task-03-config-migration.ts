/**
 * Task 03: Configuration Migration with Environment Interpolation
 *
 * Migrate a YAML config with ${ENV_VAR} interpolation to TypeScript.
 * Naive approach: line-by-line translation hardcodes interpolated values
 * or uses string literals like "${DATABASE_URL}" that don't resolve at runtime.
 *
 * The "trap" is that a direct translation of the YAML preserves the ${} syntax
 * as literal strings instead of wiring up actual process.env lookups.
 */

export const TASK_03 = {
  name: 'config-migration-env-interpolation',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project that loads configuration from a YAML file with environment variable interpolation.

The current setup uses config/app.yaml with \${ENV_VAR} placeholders that get replaced at runtime from process.env. The config-loader.ts reads the YAML, interpolates variables, and returns a typed config object.

Your task: Migrate the YAML-based configuration to a pure TypeScript config module. The new config should read from environment variables at runtime (not hardcoded values). Remove the YAML dependency entirely. The AppConfig interface and all static values (pool_size, timeout_ms, token_ttl, format) must be preserved.

Start by reading the files to understand the current structure, then perform the migration.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project that loads configuration from a YAML file with environment variable interpolation.

The current setup uses config/app.yaml with \${ENV_VAR} placeholders that get replaced at runtime from process.env. The config-loader.ts reads the YAML, interpolates variables, and returns a typed config object.

Your task: Migrate the YAML-based configuration to a pure TypeScript config module. The new config should read from environment variables at runtime (not hardcoded values). Remove the YAML dependency entirely. The AppConfig interface and all static values (pool_size, timeout_ms, token_ttl, format) must be preserved.

Start by reading the files to understand the current structure, then perform the migration.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'config/app.yaml': `server:
  host: \${SERVER_HOST}
  port: \${SERVER_PORT}

database:
  url: \${DATABASE_URL}
  pool_size: 10
  timeout_ms: 5000

auth:
  secret: \${AUTH_SECRET}
  token_ttl: 3600

logging:
  level: \${LOG_LEVEL}
  format: json
`,
    'src/config-loader.ts': `// Current YAML-based config loader (to be replaced)
import { readFileSync } from 'fs';

interface AppConfig {
  server: { host: string; port: number };
  database: { url: string; pool_size: number; timeout_ms: number };
  auth: { secret: string; token_ttl: number };
  logging: { level: string; format: string };
}

export function loadConfig(): AppConfig {
  // This loads YAML and interpolates \${VAR} from process.env
  const raw = readFileSync('config/app.yaml', 'utf8');
  const interpolated = raw.replace(/\\$\\{(\\w+)\\}/g, (_, key) => process.env[key] ?? '');
  // Pretend this parses YAML
  return JSON.parse('{}') as AppConfig;
}
`,
    'src/server.ts': `import { loadConfig } from './config-loader';

const config = loadConfig();
console.log(\`Starting server on \${config.server.host}:\${config.server.port}\`);
`,
    'src/index.ts': `export { loadConfig } from './config-loader';
`,
  },

  /**
   * Success criteria:
   * 1. A TypeScript config file exists that reads from process.env
   * 2. No hardcoded "${ENV_VAR}" string literals as config values
   * 3. process.env references for SERVER_HOST, SERVER_PORT, DATABASE_URL, AUTH_SECRET, LOG_LEVEL
   * 4. AppConfig interface (or equivalent type) is still exported
   * 5. Static values (pool_size: 10, timeout_ms: 5000, token_ttl: 3600, format: 'json') preserved
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    const allContent = [...files.values()].join('\n');
    const tsFiles = [...files.entries()].filter(([path]) => path.endsWith('.ts'));

    // 1. At least one TS file must reference process.env
    const hasProcessEnv = tsFiles.some(([_, content]) => content.includes('process.env'));
    if (!hasProcessEnv) {
      return { success: false, reason: 'No TypeScript file reads from process.env — environment variables are not wired up' };
    }

    // 2. No hardcoded "${ENV_VAR}" string literals used as config values
    // These patterns indicate the agent copied YAML interpolation syntax literally
    const hardcodedPatterns = [
      /['"]\$\{DATABASE_URL\}['"]/,
      /['"]\$\{SERVER_HOST\}['"]/,
      /['"]\$\{SERVER_PORT\}['"]/,
      /['"]\$\{AUTH_SECRET\}['"]/,
      /['"]\$\{LOG_LEVEL\}['"]/,
    ];
    for (const pattern of hardcodedPatterns) {
      const tsContent = tsFiles.map(([_, c]) => c).join('\n');
      if (pattern.test(tsContent)) {
        return { success: false, reason: `Config contains hardcoded interpolation string ${pattern.source} instead of actual process.env lookup` };
      }
    }

    // 3. Must reference process.env for each required variable
    const requiredEnvVars = ['SERVER_HOST', 'SERVER_PORT', 'DATABASE_URL', 'AUTH_SECRET', 'LOG_LEVEL'];
    const tsContent = tsFiles.map(([_, c]) => c).join('\n');
    for (const envVar of requiredEnvVars) {
      // Accept process.env.VAR or process.env['VAR'] or process.env["VAR"]
      const envPattern = new RegExp(`process\\.env\\.${envVar}|process\\.env\\[['"]${envVar}['"]\\]`);
      if (!envPattern.test(tsContent)) {
        return { success: false, reason: `Missing process.env reference for ${envVar}` };
      }
    }

    // 4. AppConfig interface or type must still be exported
    const hasExportedType = /export\s+(interface|type)\s+AppConfig/.test(tsContent);
    if (!hasExportedType) {
      return { success: false, reason: 'AppConfig interface/type is not exported from any TypeScript file' };
    }

    // 5. Static values must be preserved
    const staticChecks = [
      { name: 'pool_size: 10', pattern: /10/ },
      { name: 'timeout_ms: 5000', pattern: /5000/ },
      { name: 'token_ttl: 3600', pattern: /3600/ },
      { name: "format: 'json'", pattern: /['"]json['"]/ },
    ];
    for (const check of staticChecks) {
      if (!check.pattern.test(tsContent)) {
        return { success: false, reason: `Static config value ${check.name} is missing from the TypeScript config` };
      }
    }

    return { success: true, reason: 'Config migrated to TypeScript with proper process.env lookups, type exported, static values preserved' };
  },
};
