/**
 * Frontend types for Cost Governor API responses (PRD 051).
 * Mirrors backend types in @method/types + bridge/ports.
 */

export type InvocationSignature = {
  methodologyId: string;
  capabilities: readonly string[];
  model: string;
  inputSizeBucket: 'xs' | 's' | 'm' | 'l' | 'xl';
};

export type CostBand = {
  p50Usd: number;
  p90Usd: number;
  sampleCount: number;
  confidence: 'low' | 'medium' | 'high';
};

export type AccountUtilization = {
  accountId: string;
  burstWindowUsedPct: number;
  weeklyUsedPct: number;
  inFlightCount: number;
  backpressureActive: boolean;
  status: 'ready' | 'saturated' | 'unavailable';
};

export type UtilizationResponse = {
  accounts: AccountUtilization[];
  activeSlots: number;
};

export type Observation = {
  signature: InvocationSignature;
  costUsd: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  recordedAt: number;
  accountId: string;
  providerClass: string;
  hmac: string;
};

export type HistoryResponse = {
  count: number;
  observations: Observation[];
};

export type NodeEstimate = {
  nodeId: string;
  signature: InvocationSignature;
  cost: CostBand;
  durationMs: CostBand;
};

export type StrategyEstimate = {
  nodes: NodeEstimate[];
  totalCost: CostBand;
  totalDurationMs: CostBand;
  unknownNodes: string[];
};
