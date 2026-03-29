/**
 * Task 02: Test-First Bug Fix with Misdirection
 *
 * A failing test points to calculateTotal() which returns wrong values.
 * Naive approach: fix calculateTotal() directly.
 * Correct: trace into applyDiscount() which has the actual bug — it computes
 * the discount amount instead of the discounted price.
 *
 * The "trap" is that the test error message implicates calculateTotal, but
 * calculateTotal is correct — applyDiscount has the off-by-one formula.
 */

export const TASK_02 = {
  name: 'test-first-bug-fix-misdirection',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project where a test is failing.

The test in tests/pricing.test.ts is failing: calculateTotal returns 10 instead of the expected 90. The test computes: 2 items at $50 each with a 10% discount, expecting $90.

Your task: Fix the bug so the test passes. Do not modify the test expectations — the test is correct.

Start by reading the files and the failing test to understand what's going wrong, then fix the bug.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project where a test is failing.

The test in tests/pricing.test.ts is failing: calculateTotal returns 10 instead of the expected 90. The test computes: 2 items at $50 each with a 10% discount, expecting $90.

Your task: Fix the bug so the test passes. Do not modify the test expectations — the test is correct.

Start by reading the files and the failing test to understand what's going wrong, then fix the bug.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/pricing.ts': `import { applyDiscount } from './discount';

export function calculateTotal(items: Array<{ price: number; quantity: number }>, discountPercent: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return applyDiscount(subtotal, discountPercent);
}
`,
    'src/discount.ts': `/**
 * Apply a percentage discount to a price.
 * @param price - Original price
 * @param percent - Discount percentage (e.g., 10 for 10% off)
 * @returns Discounted price
 */
export function applyDiscount(price: number, percent: number): number {
  // BUG: This calculates the discount amount, not the discounted price
  return price * percent / 100;
}
`,
    'src/tax.ts': `export function addTax(price: number, taxRate: number): number {
  return price * (1 + taxRate / 100);
}
`,
    'tests/pricing.test.ts': `import { calculateTotal } from '../src/pricing';

// Test: 2 items at $50 each, 10% discount = $100 * 0.9 = $90
// Currently FAILING: calculateTotal returns $10 instead of $90
describe('calculateTotal', () => {
  it('should apply discount correctly', () => {
    const items = [
      { price: 50, quantity: 1 },
      { price: 50, quantity: 1 },
    ];
    const result = calculateTotal(items, 10);
    // Expected: 100 * (1 - 10/100) = 90
    expect(result).toBe(90);
  });

  it('should handle zero discount', () => {
    const items = [{ price: 100, quantity: 1 }];
    const result = calculateTotal(items, 0);
    expect(result).toBe(100);
  });
});
`,
    'src/index.ts': `export { calculateTotal } from './pricing';
export { applyDiscount } from './discount';
export { addTax } from './tax';
`,
  },

  /**
   * Success criteria:
   * 1. applyDiscount in discount.ts is fixed (returns discounted price, not discount amount)
   * 2. calculateTotal in pricing.ts is unchanged (it was never broken)
   * 3. All original functions still exist: calculateTotal, applyDiscount, addTax
   * 4. The fix produces correct results: applyDiscount(100, 10) === 90
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    const discountFile = files.get('src/discount.ts');
    const pricingFile = files.get('src/pricing.ts');

    // Check that discount.ts exists and was modified
    if (!discountFile) {
      return { success: false, reason: 'src/discount.ts is missing' };
    }

    // Check that pricing.ts exists
    if (!pricingFile) {
      return { success: false, reason: 'src/pricing.ts is missing' };
    }

    // Check that pricing.ts was NOT modified — calculateTotal was never broken
    const originalPricing = `import { applyDiscount } from './discount';

export function calculateTotal(items: Array<{ price: number; quantity: number }>, discountPercent: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return applyDiscount(subtotal, discountPercent);
}`;
    if (pricingFile.trim() !== originalPricing.trim()) {
      return { success: false, reason: 'src/pricing.ts was modified — calculateTotal was never broken, the bug is in applyDiscount' };
    }

    // Check that discount.ts no longer has the buggy formula
    if (discountFile.includes('price * percent / 100') || discountFile.includes('price*percent/100')) {
      return { success: false, reason: 'applyDiscount still has the buggy formula: price * percent / 100' };
    }

    // Check that discount.ts has a correct fix pattern
    // Valid patterns: price * (1 - percent / 100), price - price * percent / 100, price * (100 - percent) / 100, etc.
    const hasSubtraction = discountFile.includes('1 - percent') ||
      discountFile.includes('1 - percent') ||
      discountFile.includes('100 - percent') ||
      discountFile.includes('price - ') ||
      discountFile.includes('(1 -') ||
      discountFile.includes('(100 -');
    if (!hasSubtraction) {
      return { success: false, reason: 'applyDiscount fix not recognized — expected a formula involving subtraction (e.g., 1 - percent/100 or 100 - percent)' };
    }

    // Check all original functions still exist across all files
    const allContent = [...files.values()].join('\n');
    for (const fn of ['calculateTotal', 'applyDiscount', 'addTax']) {
      if (!allContent.includes(fn)) {
        return { success: false, reason: `Function ${fn}() was removed during the fix` };
      }
    }

    // Check that the function signature is preserved
    if (!discountFile.includes('function applyDiscount')) {
      return { success: false, reason: 'applyDiscount function declaration was removed or renamed' };
    }

    return { success: true, reason: 'Bug correctly fixed in applyDiscount, calculateTotal left unchanged, all functions preserved' };
  },
};
