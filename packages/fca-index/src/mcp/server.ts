#!/usr/bin/env node
/**
 * fca-index MCP server — standalone stdio server for FCA-indexed context retrieval.
 *
 * Registers 3 tools: context_query, context_detail, coverage_check.
 * Uses createDefaultFcaIndex to wire all ports. Requires VOYAGE_API_KEY.
 *
 * Usage (standalone):
 *   VOYAGE_API_KEY=... node packages/fca-index/dist/mcp/server.js
 *
 * Usage (.mcp.json):
 *   { "mcpServers": { "fca-index": { "command": "npx", "args": ["fca-index-mcp"] } } }
 *
 * DR-04: handlers are thin wrappers — parse → call port → format.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createDefaultFcaIndex } from '../factory.js';
import { ContextQueryError } from '../ports/context-query.js';
import { CoverageReportError } from '../ports/coverage-report.js';
import { ComponentDetailError } from '../ports/component-detail.js';
import type { FcaPart, FcaLevel } from '../ports/context-query.js';
import {
  formatContextQueryResult,
  formatCoverageReport,
  formatComponentDetail,
} from './formatters.js';

// ── Config ───────────────────────────────────────────────────────────────────

const ROOT = process.env.FCA_INDEX_ROOT ?? process.cwd();
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

if (!VOYAGE_API_KEY) {
  process.stderr.write(
    '[fca-index-mcp] VOYAGE_API_KEY is required. Set it in your environment or .mcp.json env block.\n',
  );
  process.exit(1);
}

// ── Init fca-index ───────────────────────────────────────────────────────────

const fca = await createDefaultFcaIndex({
  projectRoot: ROOT,
  voyageApiKey: VOYAGE_API_KEY,
});

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'context_query',
    description:
      'Query the FCA index for components relevant to a task or concept. ' +
      'Returns ranked component descriptors with excerpts. The top result is rendered with ' +
      'expanded excerpts so you can usually act on it without reading source files. ' +
      'For full implementation details on any result, call context_detail — ' +
      'it is cheaper than opening the source file. ' +
      'Use Glob (NOT this tool) for filename-shaped queries — e.g., looking for ' +
      'a specific file like "architecture.test.ts" or pattern like "**/*.contract.test.ts". ' +
      'fca-index is optimized for concept queries ("event bus implementation", ' +
      '"session lifecycle"), not filename lookups.',
    inputSchema: {
      type: 'object' as const,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural-language description of the code or concept you need' },
        topK: { type: 'number', description: 'Max results (default 5)', default: 5 },
        parts: {
          type: 'array', items: { type: 'string' },
          description: 'Filter to specific FCA parts: interface, port, domain, verification, observability, documentation, architecture, boundary',
        },
        levels: {
          type: 'array', items: { type: 'string' },
          description: 'Filter to specific FCA levels: L0, L1, L2, L3, L4, L5',
        },
        minCoverageScore: { type: 'number', description: 'Exclude components with coverage below this score (0–1)' },
      },
    },
  },
  {
    name: 'context_detail',
    description:
      'Retrieve full detail for a single indexed component by its path. ' +
      'Returns all FCA parts (with file locations and excerpts), full docText, level, and indexedAt. ' +
      'Use after context_query to get the complete picture of a specific component — ' +
      'more precise than reading the source files directly.',
    inputSchema: {
      type: 'object' as const,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Component path relative to projectRoot (e.g., "src/domains/sessions")' },
        projectRoot: { type: 'string', description: 'Absolute path to the project root (defaults to FCA_INDEX_ROOT or cwd)' },
      },
    },
  },
  {
    name: 'coverage_check',
    description:
      'Check FCA documentation coverage for a project. Returns coverage summary and ' +
      'whether the index is in discovery or production mode.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectRoot: { type: 'string', description: 'Absolute path to the project root (defaults to FCA_INDEX_ROOT or cwd)' },
        verbose: { type: 'boolean', description: 'Include per-component breakdown (default false)', default: false },
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'fca-index', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'context_query': {
      const query = String(args.query ?? '');
      const topK = typeof args.topK === 'number' ? args.topK : 5;
      const parts = Array.isArray(args.parts) ? (args.parts as FcaPart[]) : undefined;
      const levels = Array.isArray(args.levels) ? (args.levels as FcaLevel[]) : undefined;
      const minCoverageScore = typeof args.minCoverageScore === 'number' ? args.minCoverageScore : undefined;

      try {
        const result = await fca.query.query({ query, topK, parts, levels, minCoverageScore });
        return ok(formatContextQueryResult(result, query));
      } catch (e: unknown) {
        if (e instanceof ContextQueryError) {
          return ok(`[error: ${e.code}]\n${e.message}`);
        }
        throw e;
      }
    }

    case 'context_detail': {
      const path = typeof args.path === 'string' ? args.path : undefined;
      if (!path) return err('[error: INVALID_INPUT] Required parameter "path" is missing.');
      const projectRoot = typeof args.projectRoot === 'string' ? args.projectRoot : ROOT;

      try {
        const detail = await fca.detail.getDetail({ path, projectRoot });
        return ok(formatComponentDetail(detail));
      } catch (e: unknown) {
        if (e instanceof ComponentDetailError) {
          return ok(`[error: ${e.code}]\n${e.message}`);
        }
        throw e;
      }
    }

    case 'coverage_check': {
      const projectRoot = typeof args.projectRoot === 'string' ? args.projectRoot : ROOT;
      const verbose = args.verbose === true;

      try {
        const report = await fca.coverage.getReport({ projectRoot, verbose });
        return ok(formatCoverageReport(report));
      } catch (e: unknown) {
        if (e instanceof CoverageReportError) {
          return ok(`[error: ${e.code}]\n${e.message}`);
        }
        throw e;
      }
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
