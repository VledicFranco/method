// ── PRD 008: Channel infrastructure for agent visibility ─────

export type ChannelMessage = {
  sequence: number;       // monotonic per channel, starts at 1
  timestamp: string;      // ISO 8601
  sender: string;         // session identifier
  type: string;           // message type
  content: Record<string, unknown>;
};

export type Channel = {
  name: string;
  messages: ChannelMessage[];
  cursors: Map<string, number>;  // reader_id → last-read sequence
};

export type SessionChannels = {
  progress: Channel;
  events: Channel;
};

// Constants
const MAX_MESSAGES_PER_CHANNEL = 1000;

// Factory
export function createSessionChannels(): SessionChannels {
  return {
    progress: { name: 'progress', messages: [], cursors: new Map() },
    events: { name: 'events', messages: [], cursors: new Map() },
  };
}

/**
 * Append a message to a channel. Returns the sequence number.
 */
export function appendMessage(
  channel: Channel,
  sender: string,
  type: string,
  content: Record<string, unknown>,
): number {
  const sequence = channel.messages.length > 0
    ? channel.messages[channel.messages.length - 1].sequence + 1
    : 1;

  const message: ChannelMessage = {
    sequence,
    timestamp: new Date().toISOString(),
    sender,
    type,
    content,
  };

  channel.messages.push(message);

  // Evict oldest if over cap
  if (channel.messages.length > MAX_MESSAGES_PER_CHANNEL) {
    channel.messages.shift();
  }

  return sequence;
}

/**
 * Read messages since a sequence number. Returns messages and the last sequence.
 */
export function readMessages(
  channel: Channel,
  sinceSequence: number = 0,
  readerId?: string,
): { messages: ChannelMessage[]; last_sequence: number; has_more: boolean } {
  const filtered = channel.messages.filter(m => m.sequence > sinceSequence);
  const lastSeq = filtered.length > 0
    ? filtered[filtered.length - 1].sequence
    : sinceSequence;

  // Update cursor if reader_id provided
  if (readerId) {
    channel.cursors.set(readerId, lastSeq);
  }

  return {
    messages: filtered,
    last_sequence: lastSeq,
    has_more: false, // No pagination for MVP
  };
}
