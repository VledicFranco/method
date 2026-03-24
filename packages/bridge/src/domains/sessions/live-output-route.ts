import { FastifyInstance } from 'fastify';
import type { SessionPool } from './pool.js';

const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS ?? '15000', 10);

export function registerLiveOutputRoutes(
  app: FastifyInstance,
  pool: SessionPool,
): void {
  /**
   * GET /sessions/:id/stream — SSE endpoint for live PTY output
   * F-P-1: Caps initial transcript burst to 10K lines (oldest events dropped)
   */
  app.get<{ Params: { id: string } }>('/sessions/:id/stream', async (request, reply) => {
    const { id } = request.params;

    let session;
    try {
      session = pool.getSession(id);
    } catch {
      return reply.status(404).send({ error: `Session not found: ${id}` });
    }

    if (session.status === 'dead') {
      // Return final transcript for dead sessions
      return reply.status(400).send({
        error: 'Session is dead',
        final_transcript: session.transcript,
      });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial transcript burst (raw PTY data — xterm.js handles rendering)
    // F-P-1: Cap transcript to 10K lines, dropping oldest events first
    if (session.transcript) {
      let cappedTranscript = session.transcript;
      const lines = cappedTranscript.split('\n');
      if (lines.length > 10000) {
        // Keep only the latest 10000 lines
        cappedTranscript = lines.slice(lines.length - 10000).join('\n');
      }
      const initialData = JSON.stringify({ text: cappedTranscript, timestamp: new Date().toISOString() });
      reply.raw.write(`data: ${initialData}\n\n`);
    }

    // Subscribe to live output (raw PTY data — xterm.js handles rendering)
    const unsubscribe = session.onOutput((data: string) => {
      const payload = JSON.stringify({ text: data, timestamp: new Date().toISOString() });
      reply.raw.write(`data: ${payload}\n\n`);
    });

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });
}
