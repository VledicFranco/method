import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import type { TheoryResult } from './types.js';

type TheorySection = {
  source: string;
  heading: string;
  label: string | null;
  content: string;
};

const cache = new Map<string, TheorySection[]>();

const LABEL_PATTERN = /\*\*(?:Definition|Proposition|Observation|Clarification|Corollary|Sketch)\s*[\d.]*\s*(?:\(([^)]+)\))?\.?\*\*/;

function parseTheoryFile(filePath: string): TheorySection[] {
  const raw = readFileSync(filePath, 'utf-8');
  const source = basename(filePath);
  const sections: TheorySection[] = [];

  // Split on ## headings
  const headingPattern = /^## /m;
  const parts = raw.split(headingPattern);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const newlineIdx = part.indexOf('\n');
    const heading = newlineIdx >= 0 ? part.substring(0, newlineIdx).trim() : part.trim();
    const body = newlineIdx >= 0 ? part.substring(newlineIdx + 1) : '';

    // Split body into sub-sections at definition/proposition labels
    const lines = body.split('\n');
    let currentLabel: string | null = null;
    let currentContent: string[] = [];
    let hasSubSections = false;

    for (const line of lines) {
      const match = line.match(LABEL_PATTERN);
      if (match) {
        // Flush previous sub-section
        if (currentContent.length > 0 || hasSubSections) {
          sections.push({
            source,
            heading,
            label: currentLabel,
            content: currentContent.join('\n').trim(),
          });
        }
        hasSubSections = true;
        currentLabel = match[1] ?? null;
        currentContent = [line];
      } else {
        currentContent.push(line);
      }
    }

    // Flush final sub-section (or the whole section if no labels found)
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

function getSections(filePath: string): TheorySection[] {
  if (!cache.has(filePath)) {
    cache.set(filePath, parseTheoryFile(filePath));
  }
  return cache.get(filePath)!;
}

function toResult(s: TheorySection): TheoryResult {
  const r: TheoryResult = { source: s.source, section: s.heading, content: s.content };
  if (s.label) r.label = s.label;
  return r;
}

export function lookupTheory(theoryPath: string, term: string): TheoryResult[] {
  const files = readdirSync(theoryPath)
    .filter(f => f.endsWith('.md'))
    .map(f => join(theoryPath, f));

  const allSections: TheorySection[] = [];
  for (const f of files) {
    allSections.push(...getSections(f));
  }

  const termLower = term.toLowerCase();

  // Pass 1: definition label match
  const labelMatches = allSections.filter(
    s => s.label && s.label.toLowerCase().includes(termLower)
  );
  if (labelMatches.length > 0) {
    return labelMatches.map(toResult);
  }

  // Pass 2: heading match — merge all sub-sections under matching headings
  const headingMatches = new Map<string, TheorySection[]>();
  for (const s of allSections) {
    if (s.heading.toLowerCase().includes(termLower)) {
      const key = `${s.source}::${s.heading}`;
      if (!headingMatches.has(key)) headingMatches.set(key, []);
      headingMatches.get(key)!.push(s);
    }
  }
  if (headingMatches.size > 0) {
    const results: TheoryResult[] = [];
    for (const [, secs] of headingMatches) {
      const merged = secs.map(s => s.content).join('\n\n');
      results.push({
        source: secs[0].source,
        section: secs[0].heading,
        content: merged.trim(),
      });
    }
    return results;
  }

  // Pass 3: keyword search in body — return smallest enclosing unit, cap at 3
  const keywordMatches = allSections.filter(
    s => s.content.toLowerCase().includes(termLower)
  );
  return keywordMatches.slice(0, 3).map(toResult);
}
