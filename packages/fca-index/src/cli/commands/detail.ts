/**
 * detail command — retrieve full component detail from the FCA index.
 */

import type { ComponentDetailPort, ComponentDetailRequest } from '../../ports/component-detail.js';
import { ComponentDetailError } from '../../ports/component-detail.js';

export async function runDetailCommand(
  detailPort: ComponentDetailPort,
  request: ComponentDetailRequest,
): Promise<void> {
  let detail;
  try {
    detail = await detailPort.getDetail(request);
  } catch (err) {
    if (err instanceof ComponentDetailError) {
      if (err.code === 'NOT_FOUND' || err.code === 'INDEX_NOT_FOUND') {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exit(1);
      }
    }
    throw err;
  }

  process.stdout.write(JSON.stringify(detail, null, 2) + '\n');
}
