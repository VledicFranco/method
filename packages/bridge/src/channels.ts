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
  /** Materialized view of the ring buffer contents (ordered oldest→newest). */
  readonly messages: ChannelMessage[];
  cursors: Map<string, number>;  // reader_id → last-read sequence
};

export type SessionChannels = {
  progress: Channel;
  events: Channel;
};

// Constants
const MAX_MESSAGES_PER_CHANNEL = 1000;

// ── Ring buffer for O(1) append + eviction ───────────────────

export class ChannelRingBuffer {
  private buf: (ChannelMessage | undefined)[];
  private head = 0;   // index of oldest element
  private count = 0;  // number of live elements
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get length(): number { return this.count; }

  /** O(1) append — overwrites oldest slot when full. */
  push(msg: ChannelMessage): void {
    const writeIdx = (this.head + this.count) % this.capacity;
    this.buf[writeIdx] = msg;
    if (this.count === this.capacity) {
      // Buffer full — advance head (evict oldest) in O(1)
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }
  }

  /** Last (newest) element, or undefined if empty. */
  last(): ChannelMessage | undefined {
    if (this.count === 0) return undefined;
    return this.buf[(this.head + this.count - 1) % this.capacity];
  }

  /** Return messages matching predicate, ordered oldest→newest. */
  filter(fn: (msg: ChannelMessage) => boolean): ChannelMessage[] {
    const result: ChannelMessage[] = [];
    for (let i = 0; i < this.count; i++) {
      const msg = this.buf[(this.head + i) % this.capacity]!;
      if (fn(msg)) result.push(msg);
    }
    return result;
  }

  /** Materialize full contents as a plain array (oldest→newest). */
  toArray(): ChannelMessage[] {
    const result: ChannelMessage[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity]!;
    }
    return result;
  }
}

// ── Internal ring-buffer storage (hidden from Channel type) ──

const rings = new WeakMap<Channel, ChannelRingBuffer>();

/** @internal Retrieve the ring buffer backing a channel. */
export function getChannelRing(channel: Channel): ChannelRingBuffer {
  return rings.get(channel)!;
}

// Factory

function createChannel(name: string): Channel {
  const ring = new ChannelRingBuffer(MAX_MESSAGES_PER_CHANNEL);
  const channel: Channel = {
    name,
    get messages() { return ring.toArray(); },
    cursors: new Map(),
  };
  rings.set(channel, ring);
  return channel;
}

export function createSessionChannels(): SessionChannels {
  return {
    progress: createChannel('progress'),
    events: createChannel('events'),
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
  const ring = rings.get(channel)!;
  const last = ring.last();
  const sequence = last ? last.sequence + 1 : 1;

  const message: ChannelMessage = {
    sequence,
    timestamp: new Date().toISOString(),
    sender,
    type,
    content,
  };

  // O(1) push — ring buffer handles eviction internally
  ring.push(message);

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
  const ring = rings.get(channel)!;
  const filtered = ring.filter(m => m.sequence > sinceSequence);
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
