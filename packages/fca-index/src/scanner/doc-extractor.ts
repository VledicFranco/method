/**
 * DocExtractor — Extracts a short documentation excerpt from a source file.
 *
 * Extraction rules by file type:
 *   - README.md / *.md : first paragraph (text before first blank line), trimmed to ≤ 600 chars
 *   - index.ts (interface part) : exported type/interface/function signatures, first 600 chars
 *   - Other TS files : JSDoc block at the top (/** ... *​/) first 600 chars
 *   - Fallback : first 600 chars of file content
 */

import type { FileSystemPort } from '../ports/internal/file-system.js';
import type { FcaPart } from '../ports/context-query.js';

const MAX_EXCERPT = 600;

export class DocExtractor {
  constructor(private readonly fs: FileSystemPort) {}

  async extract(filePath: string, part: FcaPart): Promise<string> {
    const content = await this.fs.readFile(filePath, 'utf-8');
    const fileName = filePath.split('/').pop() ?? '';

    if (fileName.endsWith('.md')) {
      return this.extractMarkdownParagraph(content);
    }

    if (part === 'interface' && fileName === 'index.ts') {
      return this.extractExportedSignatures(content);
    }

    const jsdoc = this.extractJsDoc(content);
    if (jsdoc) return jsdoc;

    return content.slice(0, MAX_EXCERPT).trimEnd();
  }

  private extractMarkdownParagraph(content: string): string {
    // Find first non-empty line, then read until first blank line
    const lines = content.split('\n');
    let started = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      if (!started) {
        if (line.trim() !== '') {
          started = true;
          paragraphLines.push(line);
        }
      } else {
        if (line.trim() === '') break;
        paragraphLines.push(line);
      }
    }

    return paragraphLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  }

  private extractExportedSignatures(content: string): string {
    const lines = content.split('\n');
    const sigLines: string[] = [];

    for (const line of lines) {
      // Match exported declarations: export type, export interface, export function, export class, export const, export abstract
      if (/^\s*export\s+(type|interface|function|class|abstract|const|enum|declare)/.test(line)) {
        sigLines.push(line);
      }
    }

    if (sigLines.length === 0) {
      return content.slice(0, MAX_EXCERPT).trimEnd();
    }

    return sigLines.join('\n').slice(0, MAX_EXCERPT).trimEnd();
  }

  private extractJsDoc(content: string): string {
    // Find leading /** ... */ block
    const match = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!match) return '';
    return match[0].slice(0, MAX_EXCERPT).trimEnd();
  }
}
