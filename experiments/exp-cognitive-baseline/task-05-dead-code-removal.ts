/**
 * Task 05: Dead Code Removal with Dynamic Reference Trap
 *
 * A module appears unused in the static import graph but is loaded dynamically
 * via string-based `require()`. Naively deleting it breaks the dynamic loader.
 *
 * The "trap" is that `src/plugins/legacy-parser.ts` has no static imports
 * pointing to it. A naive agent doing grep for imports will not find it. But
 * `src/plugin-loader.ts` loads plugins dynamically: `require('./plugins/' + pluginName)`.
 * Deleting legacy-parser.ts breaks the loader when it tries to load 'legacy-parser'.
 */

export const TASK_05 = {
  name: 'dead-code-removal-dynamic-trap',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project that needs dead code cleanup.

The codebase has unused code that should be cleaned up. Review all files, identify any truly dead code, and remove it. Be careful: some code that appears unused may be loaded dynamically. Only remove code that is genuinely unreachable.

Start by reading the files to understand the current structure, then remove any dead code you find.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project that needs dead code cleanup.

The codebase has unused code that should be cleaned up. Review all files, identify any truly dead code, and remove it. Be careful: some code that appears unused may be loaded dynamically. Only remove code that is genuinely unreachable.

Start by reading the files to understand the current structure, then remove any dead code you find.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/plugins/json-parser.ts': `export function parse(input: string): unknown {
  return JSON.parse(input);
}

export const name = 'json-parser';
`,
    'src/plugins/xml-parser.ts': `export function parse(input: string): unknown {
  // Simple XML-like parsing (mock)
  const match = input.match(/<value>(.*?)<\\/value>/);
  return match ? match[1] : null;
}

export const name = 'xml-parser';
`,
    'src/plugins/legacy-parser.ts': `// This parser handles the old proprietary format from the v1 system.
// It looks unused but is loaded dynamically by the plugin loader.
export function parse(input: string): unknown {
  const lines = input.split('\\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const [key, value] = line.split('=');
    if (key && value) result[key.trim()] = value.trim();
  }
  return result;
}

export const name = 'legacy-parser';
`,
    'src/plugin-loader.ts': `// Dynamic plugin loading — plugins are loaded by name at runtime
const PLUGIN_REGISTRY = ['json-parser', 'xml-parser', 'legacy-parser'];

interface Plugin {
  parse(input: string): unknown;
  name: string;
}

export function loadPlugin(pluginName: string): Plugin {
  if (!PLUGIN_REGISTRY.includes(pluginName)) {
    throw new Error(\`Unknown plugin: \${pluginName}\`);
  }
  // Dynamic require — the plugin name is resolved at runtime
  const plugin = require('./plugins/' + pluginName);
  return plugin as Plugin;
}

export function listPlugins(): string[] {
  return [...PLUGIN_REGISTRY];
}
`,
    'src/processor.ts': `import { loadPlugin } from './plugin-loader';

export function processInput(input: string, format: string): unknown {
  const plugin = loadPlugin(format);
  return plugin.parse(input);
}
`,
    'src/index.ts': `export { processInput } from './processor';
export { loadPlugin, listPlugins } from './plugin-loader';
`,
  },

  /**
   * Success criteria: legacy-parser.ts must NOT be deleted, all plugins must
   * retain their exports, plugin-loader must still work, and processInput
   * must still exist. The correct outcome is the agent recognizes there is
   * no actual dead code to remove.
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    // 1. legacy-parser.ts must NOT be deleted
    const legacyParser = files.get('src/plugins/legacy-parser.ts');
    if (!legacyParser) {
      return { success: false, reason: 'legacy-parser.ts was deleted — it is dynamically loaded by plugin-loader.ts' };
    }

    // 2. All three parser plugins must exist with parse and name exports
    const parsers = ['json-parser', 'xml-parser', 'legacy-parser'];
    for (const parser of parsers) {
      const content = files.get(`src/plugins/${parser}.ts`);
      if (!content) {
        return { success: false, reason: `Plugin ${parser}.ts was deleted` };
      }
      if (!content.includes('export function parse')) {
        return { success: false, reason: `Plugin ${parser}.ts is missing its parse export` };
      }
      if (!content.includes('export const name')) {
        return { success: false, reason: `Plugin ${parser}.ts is missing its name export` };
      }
    }

    // 3. plugin-loader.ts must still work (PLUGIN_REGISTRY, loadPlugin, dynamic require)
    const loader = files.get('src/plugin-loader.ts');
    if (!loader) {
      return { success: false, reason: 'plugin-loader.ts was deleted' };
    }
    if (!loader.includes('PLUGIN_REGISTRY')) {
      return { success: false, reason: 'PLUGIN_REGISTRY was removed from plugin-loader.ts' };
    }
    if (!loader.includes('loadPlugin')) {
      return { success: false, reason: 'loadPlugin function was removed from plugin-loader.ts' };
    }
    if (!loader.includes('legacy-parser')) {
      return { success: false, reason: 'legacy-parser was removed from PLUGIN_REGISTRY in plugin-loader.ts' };
    }
    if (!loader.includes("require('./plugins/'")) {
      return { success: false, reason: 'Dynamic require pattern was removed from plugin-loader.ts' };
    }

    // 4. processInput must still exist
    const allContent = [...files.values()].join('\n');
    if (!allContent.includes('processInput')) {
      return { success: false, reason: 'processInput function was removed' };
    }

    // 5. No functional code should have been removed — check key functions still exist
    if (!allContent.includes('listPlugins')) {
      return { success: false, reason: 'listPlugins function was removed' };
    }

    return { success: true, reason: 'All files preserved — agent correctly identified no dead code exists' };
  },
};
