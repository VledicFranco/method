// ── method-ctl — CLI Entry Point ────────────────────────────────
//
// Parse argv, resolve config, dispatch to command handlers.
// Minimal dependency: process.argv parsing, no yargs/commander.

import { loadConfig, resolveBridgeAddress, resolveFormat } from './config.js';
import { statusCommand } from './commands/status.js';
import { nodesCommand } from './commands/nodes.js';
import { projectsCommand } from './commands/projects.js';

// ── Version ─────────────────────────────────────────────────────

const VERSION = '0.1.0';

// ── Arg Parsing ─────────────────────────────────────────────────

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  // Skip node and script path
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];

      // Boolean flags (no value after them, or next arg is also a flag)
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }

    i++;
  }

  return { command, positional, flags };
}

// ── Help ────────────────────────────────────────────────────────

const HELP = `method-ctl — unified cluster management CLI

Usage:
  method-ctl <command> [options]

Commands:
  status              Cluster health overview (nodes, capacity, sessions)
  nodes [name]        List nodes or show detail for a single node
  projects            List projects across all cluster nodes

Global Options:
  --bridge <address>  Bridge address (default: from config or localhost:3456)
  --format <fmt>      Output format: table | json (default: table)
  --help              Show this help message
  --version           Show version

Configuration:
  Config file: ~/.method/cluster.json

  Example:
    {
      "default_bridge": "localhost:3456",
      "known_bridges": [
        { "name": "mission-control", "address": "mission-control.emu-cosmological.ts.net:3456" }
      ],
      "output_format": "table"
    }

Examples:
  method-ctl status                          # Cluster overview
  method-ctl status --format json            # Raw JSON output
  method-ctl nodes                           # List all nodes
  method-ctl nodes mission-control           # Detail for one node
  method-ctl projects                        # Projects across cluster
  method-ctl status --bridge laptop:3456     # Query specific bridge
`;

// ── Dispatch ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // --help at any position
  if (parsed.flags['help']) {
    process.stdout.write(HELP);
    return;
  }

  // --version
  if (parsed.flags['version']) {
    process.stdout.write(`method-ctl v${VERSION}\n`);
    return;
  }

  // No command — show help
  if (!parsed.command) {
    process.stdout.write(HELP);
    return;
  }

  // Load config and resolve global options
  const config = loadConfig();
  const bridge = resolveBridgeAddress(
    typeof parsed.flags['bridge'] === 'string' ? parsed.flags['bridge'] : undefined,
    config,
  );
  const format = resolveFormat(
    typeof parsed.flags['format'] === 'string' ? parsed.flags['format'] : undefined,
    config,
  );

  switch (parsed.command) {
    case 'status':
      await statusCommand({ bridge, format });
      break;

    case 'nodes':
      await nodesCommand({ bridge, format, name: parsed.positional[0] });
      break;

    case 'projects':
      await projectsCommand({ bridge, format });
      break;

    default:
      process.stderr.write(`Unknown command: ${parsed.command}\n\n`);
      process.stdout.write(HELP);
      process.exitCode = 1;
      break;
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
