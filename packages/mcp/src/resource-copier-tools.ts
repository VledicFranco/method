/**
 * PRD 020 Phase 3: Resource Copier MCP Tools
 *
 * MCP tool wrappers for resource_copy_methodology and resource_copy_strategy.
 * These tools allow agents to copy methodologies and strategies between projects.
 *
 * All tools make HTTP requests to the bridge server (BRIDGE_URL).
 */

export async function bridgeFetch(
  bridgeUrl: string,
  endpoint: string,
  method: string = 'POST',
  body?: any,
): Promise<Response> {
  const url = `${bridgeUrl}${endpoint}`;

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      const msg = [errBody.error, errBody.message].filter(Boolean).join(': ') || res.statusText;
      throw new Error(`Bridge error: ${msg}`);
    }

    return res;
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Bridge error: connection refused — is the bridge running on ${bridgeUrl}?`);
    }
    throw e;
  }
}

/**
 * Resource copy methodology tool handler
 */
export async function handleCopyMethodology(
  bridgeUrl: string,
  args: {
    source_id: string;
    method_name: string;
    target_ids: string[];
  },
): Promise<any> {
  const res = await bridgeFetch(bridgeUrl, '/api/resources/copy-methodology', 'POST', args);
  return res.json();
}

/**
 * Resource copy strategy tool handler
 */
export async function handleCopyStrategy(
  bridgeUrl: string,
  args: {
    source_id: string;
    strategy_name: string;
    target_ids: string[];
  },
): Promise<any> {
  const res = await bridgeFetch(bridgeUrl, '/api/resources/copy-strategy', 'POST', args);
  return res.json();
}
