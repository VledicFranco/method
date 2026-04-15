/**
 * Built-in conformance plugins. `DEFAULT_PLUGINS` is the default value for
 * `opts.plugins`; callers extending the set should do
 * `plugins: [...DEFAULT_PLUGINS, myPlugin]`.
 */

export { s1MethodAgentPortPlugin } from './s1-method-agent-port.js';
export { s3ServiceAdaptersPlugin } from './s3-service-adapters.js';

import type { ConformancePlugin } from '../plugin.js';
import { s1MethodAgentPortPlugin } from './s1-method-agent-port.js';
import { s3ServiceAdaptersPlugin } from './s3-service-adapters.js';

export const DEFAULT_PLUGINS: ReadonlyArray<ConformancePlugin> = [
  s1MethodAgentPortPlugin,
  s3ServiceAdaptersPlugin,
];
