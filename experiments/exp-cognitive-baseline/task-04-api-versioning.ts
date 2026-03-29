/**
 * Task 04: API Versioning with Side Effect Trap
 *
 * Add a v2 API endpoint that coexists with v1. The v1 handler has side effects
 * (sends notifications, writes audit log) that v2 must NOT trigger.
 *
 * Naive approach: copy the v1 handler and modify the response format.
 * But the side effects are buried inside processOrder(), so copying the handler
 * also copies the side effects. Correct: extract the pure business logic from
 * the side-effect-laden handler.
 *
 * The "trap" is that processOrder() conflates pure computation with side effects,
 * so any v2 handler that reuses or copies it will inherit the notifications and audit logging.
 */

export const TASK_04 = {
  name: 'api-versioning-side-effect-trap',
  // For flat/CLI conditions — no cognitive-specific signals
  baseDescription: `You are working on a TypeScript project with a v1 API handler for processing orders.

The v1 handler in src/handlers/v1.ts processes orders and returns \`{ success: true, data: { total, status } }\`. It also triggers side effects: sending notifications and writing audit logs.

Your task: Add a v2 API endpoint. The v2 handler should return a different response format: \`{ ok: true, order: { total, status, itemCount } }\` — it adds itemCount (the number of items in the order). CRITICAL: The v2 handler must NOT trigger notifications or audit logging. The v1 handler must continue working exactly as before (including its side effects).

Update the router in src/router.ts to handle 'v2' requests, and update src/index.ts to export the new handler.

Start by reading the files to understand the current structure, then implement the v2 endpoint.`,
  // For cognitive condition — includes "done" completion signal
  description: `You are working on a TypeScript project with a v1 API handler for processing orders.

The v1 handler in src/handlers/v1.ts processes orders and returns \`{ success: true, data: { total, status } }\`. It also triggers side effects: sending notifications and writing audit logs.

Your task: Add a v2 API endpoint. The v2 handler should return a different response format: \`{ ok: true, order: { total, status, itemCount } }\` — it adds itemCount (the number of items in the order). CRITICAL: The v2 handler must NOT trigger notifications or audit logging. The v1 handler must continue working exactly as before (including its side effects).

Update the router in src/router.ts to handle 'v2' requests, and update src/index.ts to export the new handler.

Start by reading the files to understand the current structure, then implement the v2 endpoint.

When you are done, signal completion with the "done" action.`,

  initialFiles: {
    'src/handlers/v1.ts': `import { sendNotification } from '../services/notifications';
import { writeAuditLog } from '../services/audit';

interface Order {
  id: string;
  items: Array<{ name: string; price: number }>;
  customer: string;
}

function processOrder(order: Order): { total: number; status: string } {
  const total = order.items.reduce((sum, item) => sum + item.price, 0);

  // Side effects embedded in the processing logic
  sendNotification(order.customer, \`Order \${order.id} processed: $\${total}\`);
  writeAuditLog('order_processed', { orderId: order.id, total });

  return { total, status: 'completed' };
}

export function handleOrderV1(order: Order): { success: boolean; data: { total: number; status: string } } {
  const result = processOrder(order);
  return { success: true, data: result };
}
`,
    'src/services/notifications.ts': `// Notification service — sends emails/push notifications
export function sendNotification(recipient: string, message: string): void {
  console.log(\`[NOTIFY] To: \${recipient}, Message: \${message}\`);
}
`,
    'src/services/audit.ts': `// Audit logging service — writes to compliance log
export function writeAuditLog(event: string, data: Record<string, unknown>): void {
  console.log(\`[AUDIT] \${event}: \${JSON.stringify(data)}\`);
}
`,
    'src/router.ts': `import { handleOrderV1 } from './handlers/v1';

export function route(version: string, order: any) {
  if (version === 'v1') return handleOrderV1(order);
  throw new Error(\`Unknown API version: \${version}\`);
}
`,
    'src/index.ts': `export { route } from './router';
export { handleOrderV1 } from './handlers/v1';
`,
  },

  /**
   * Success criteria:
   * 1. A v2 handler file or function exists (handleOrderV2 exported somewhere)
   * 2. The v2 handler/file does NOT import from notifications or audit services
   * 3. The v2 response includes itemCount
   * 4. The v1 handler is unchanged (still imports notifications and audit, still calls processOrder with side effects)
   * 5. The router handles 'v2' version
   * 6. Pure business logic is extracted somewhere (a function that computes total without side effects)
   */
  validate(files: ReadonlyMap<string, string>): { success: boolean; reason: string } {
    const v1File = files.get('src/handlers/v1.ts');
    const routerFile = files.get('src/router.ts');

    // --- Check 1: v1 handler must still exist ---
    if (!v1File) {
      return { success: false, reason: 'src/handlers/v1.ts is missing' };
    }

    // --- Check 4: v1 handler must be unchanged ---
    if (!v1File.includes("import { sendNotification }") || !v1File.includes("from '../services/notifications'")) {
      return { success: false, reason: 'v1 handler no longer imports sendNotification from notifications service' };
    }
    if (!v1File.includes("import { writeAuditLog }") || !v1File.includes("from '../services/audit'")) {
      return { success: false, reason: 'v1 handler no longer imports writeAuditLog from audit service' };
    }
    if (!v1File.includes('sendNotification(') || !v1File.includes('writeAuditLog(')) {
      return { success: false, reason: 'v1 handler no longer calls sendNotification or writeAuditLog' };
    }
    if (!v1File.includes('function handleOrderV1')) {
      return { success: false, reason: 'handleOrderV1 function was removed or renamed in v1 handler' };
    }

    // --- Check 1: v2 handler must exist ---
    // Find any file that contains handleOrderV2
    let v2Content: string | undefined;
    let v2Path: string | undefined;
    for (const [path, content] of files) {
      if (content.includes('handleOrderV2')) {
        v2Content = content;
        v2Path = path;
        break;
      }
    }
    if (!v2Content || !v2Path) {
      return { success: false, reason: 'No file contains handleOrderV2 — v2 handler not found' };
    }

    // --- Check 2: v2 handler must NOT import notifications or audit ---
    // Find the actual v2 handler file (the one that defines the function, not just imports it)
    let v2DefFile: string | undefined;
    let v2DefPath: string | undefined;
    for (const [path, content] of files) {
      if (content.includes('function handleOrderV2')) {
        v2DefFile = content;
        v2DefPath = path;
        break;
      }
    }
    if (!v2DefFile || !v2DefPath) {
      return { success: false, reason: 'handleOrderV2 is referenced but never defined as a function' };
    }
    if (v2DefFile.includes("notifications") && v2DefFile.includes("import")) {
      // Check if it's actually importing from notifications
      if (v2DefFile.includes("from") && (v2DefFile.includes("notifications'") || v2DefFile.includes('notifications"'))) {
        return { success: false, reason: `v2 handler file (${v2DefPath}) imports from notifications service — v2 must not trigger notifications` };
      }
    }
    if (v2DefFile.includes("audit") && v2DefFile.includes("import")) {
      if (v2DefFile.includes("from") && (v2DefFile.includes("audit'") || v2DefFile.includes('audit"'))) {
        return { success: false, reason: `v2 handler file (${v2DefPath}) imports from audit service — v2 must not trigger audit logging` };
      }
    }
    // Also check for direct calls to side-effect functions in the v2 definition file
    if (v2DefFile.includes('sendNotification(')) {
      return { success: false, reason: `v2 handler file (${v2DefPath}) calls sendNotification — v2 must not trigger notifications` };
    }
    if (v2DefFile.includes('writeAuditLog(')) {
      return { success: false, reason: `v2 handler file (${v2DefPath}) calls writeAuditLog — v2 must not trigger audit logging` };
    }

    // --- Check 3: v2 response must include itemCount ---
    if (!v2DefFile.includes('itemCount')) {
      return { success: false, reason: 'v2 handler does not include itemCount in its response' };
    }

    // --- Check 5: router must handle v2 ---
    if (!routerFile) {
      return { success: false, reason: 'src/router.ts is missing' };
    }
    if (!routerFile.includes("'v2'") && !routerFile.includes('"v2"')) {
      return { success: false, reason: 'Router does not handle v2 version' };
    }
    if (!routerFile.includes('handleOrderV2')) {
      return { success: false, reason: 'Router does not reference handleOrderV2' };
    }

    // --- Check 6: pure business logic must be extracted ---
    // Look for a function that computes total without side effects — somewhere other than
    // inside v1's processOrder (which has side effects). The v2 file or a shared module
    // should have pure computation logic.
    const allContent = [...files.values()].join('\n');

    // The v2 definition file should contain or import pure computation logic.
    // Check that there's a reduce/sum computation for total that doesn't live alongside
    // sendNotification/writeAuditLog calls.
    const hasExtractedLogic =
      // Option A: v2 file has its own pure computation
      (v2DefFile.includes('.reduce(') || v2DefFile.includes('.reduce (')) ||
      // Option B: a separate shared/pure module exists
      [...files.entries()].some(([path, content]) =>
        path !== 'src/handlers/v1.ts' &&
        (content.includes('.reduce(') || content.includes('total')) &&
        !content.includes('sendNotification') &&
        !content.includes('writeAuditLog') &&
        path.endsWith('.ts') &&
        path !== 'src/services/notifications.ts' &&
        path !== 'src/services/audit.ts' &&
        path !== 'src/router.ts' &&
        path !== 'src/index.ts'
      );

    if (!hasExtractedLogic) {
      return { success: false, reason: 'No pure business logic extraction detected — v2 must compute the total without relying on the side-effect-laden processOrder' };
    }

    return { success: true, reason: 'v2 handler added with pure business logic, no side effects; v1 unchanged; router updated; itemCount included' };
  },
};
