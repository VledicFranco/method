/**
 * Theory Lookup — inlined from @method/core for WS-1 dependency elimination.
 *
 * Searches formal theory files (F1-FTH, F4-PHI) for terms and definitions.
 * Three-pass lookup: label match > heading match > keyword search.
 *
 * This is the only piece of @method/core that MCP consumed. Inlining it here
 * allows @method/mcp to drop its @method/core dependency entirely.
 *
 * Accepts an optional TheoryFs parameter for testability (DR-15 port pattern).
 */

import * as nodeFs from 'fs';
import { join, basename } from 'path';

// ── Types ──

export type TheoryResult = {
  source: string;
  section: string;
  label?: string;
  content: string;
};

type TheorySection = {
  source: string;
  heading: string;
  label: string | null;
  content: string;
};

/** Filesystem interface for theory file access (testability seam). */
export interface TheoryFs {
  readFileSync(path: string, encoding: 'utf-8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
}

const defaultFs: TheoryFs = {
  readFileSync: (p, enc) => nodeFs.readFileSync(p, enc),
  readdirSync: (p, opts) => nodeFs.readdirSync(p, opts) as Array<{ name: string; isDirectory(): boolean }>,
};

// ── Internal ──

const cache = new Map<string, TheorySection[]>();

const LABEL_PATTERN = /\*\*(?:Definition|Proposition|Observation|Clarification|Corollary|Sketch)\s*[\d.]*\s*(?:\(([^)]+)\))?\.?\*\*/;

function parseTheoryFile(filePath: string, fs: TheoryFs = defaultFs): TheorySection[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const source = basename(filePath);
  const sections: TheorySection[] = [];

  const headingPattern = /^## /m;
  const parts = raw.split(headingPattern);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const newlineIdx = part.indexOf('\n');
    const heading = newlineIdx >= 0 ? part.substring(0, newlineIdx).trim() : part.trim();
    const body = newlineIdx >= 0 ? part.substring(newlineIdx + 1) : '';

    const lines = body.split('\n');
    let currentLabel: string | null = null;
    let currentContent: string[] = [];
    let hasSubSections = false;

    for (const line of lines) {
      const match = line.match(LABEL_PATTERN);
      if (match) {
        if (currentContent.length > 0 || hasSubSections) {
          sections.push({ source, heading, label: currentLabel, content: currentContent.join('\n').trim() });
        }
        hasSubSections = true;
        currentLabel = match[1] ?? null;
        currentContent = [line];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections.push({
        source,
        heading,
        label: hasSubSections ? currentLabel : null,
        content: currentContent.join('\n').trim(),
      });
    }
  }

  return sections;
}

function getSections(filePath: string, fs: TheoryFs = defaultFs): TheorySection[] {
  if (!cache.has(filePath)) {
    cache.set(filePath, parseTheoryFile(filePath, fs));
  }
  return cache.get(filePath)!;
}

function toResult(s: TheorySection): TheoryResult {
  const r: TheoryResult = { source: s.source, section: s.heading, content: s.content };
  if (s.label) r.label = s.label;
  return r;
}

function normalizeForSearch(text: string): string {
  const greekMap: [RegExp, string][] = [
    [/Φ/g, 'Phi'], [/φ/g, 'phi'],
    [/Σ/g, 'Sigma'], [/σ/g, 'sigma'],
    [/Γ/g, 'Gamma'], [/γ/g, 'gamma'],
    [/δ/g, 'delta'],
    [/μ/g, 'mu'],
    [/π/g, 'pi'],
    [/ρ/g, 'rho'],
    [/ν/g, 'nu'],
    [/≼/g, 'preceq'],
    [/→/g, '->'],
    [/∈/g, 'in'],
  ];
  let result = text;
  for (const [pattern, replacement] of greekMap) {
    result = result.replace(pattern, replacement);
  }
  return result.toLowerCase();
}

// ── Public API ──

export function lookupTheory(theoryPath: string, term: string, fs: TheoryFs = defaultFs): TheoryResult[] {
  const files = fs.readdirSync(theoryPath, { withFileTypes: true })
    .filter(f => f.name.endsWith('.md'))
    .map(f => join(theoryPath, f.name));

  const allSections: TheorySection[] = [];
  for (const f of files) {
    allSections.push(...getSections(f, fs));
  }

  const normalizedTerm = normalizeForSearch(term);

  // Pass 1: definition label match
  const labelMatches = allSections.filter(
    s => s.label && normalizeForSearch(s.label).includes(normalizedTerm)
  );
  if (labelMatches.length > 0) {
    return labelMatches.map(toResult);
  }

  // Pass 2: heading match — merge all sub-sections under matching headings
  const headingMatches = new Map<string, TheorySection[]>();
  for (const s of allSections) {
    if (normalizeForSearch(s.heading).includes(normalizedTerm)) {
      const key = `${s.source}::${s.heading}`;
      if (!headingMatches.has(key)) headingMatches.set(key, []);
      headingMatches.get(key)!.push(s);
    }
  }
  if (headingMatches.size > 0) {
    const results: TheoryResult[] = [];
    for (const [, secs] of headingMatches) {
      const merged = secs.map(s => s.content).join('\n\n');
      results.push({ source: secs[0].source, section: secs[0].heading, content: merged.trim() });
    }
    return results;
  }

  // Pass 3: keyword search in body — return smallest enclosing unit, cap at 3
  const keywordMatches = allSections.filter(
    s => normalizeForSearch(s.content).includes(normalizedTerm)
  );
  return keywordMatches.slice(0, 3).map(toResult);
}
