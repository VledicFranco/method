/**
 * Browser-compatible shim for Node.js crypto.createHash.
 * Used by @glyphjs/ir for document ID generation.
 * Only needs to produce deterministic strings — no cryptographic security required.
 */

class BrowserHash {
  private data = '';

  update(input: string): this {
    this.data += input;
    return this;
  }

  digest(encoding: string): string {
    // Simple FNV-1a-like hash — deterministic, fast, no crypto needed
    let h = 0x811c9dc5;
    for (let i = 0; i < this.data.length; i++) {
      h ^= this.data.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const hex = (h >>> 0).toString(16).padStart(8, '0');
    if (encoding === 'hex') return hex;
    return hex;
  }
}

export function createHash(_algorithm: string): BrowserHash {
  return new BrowserHash();
}
