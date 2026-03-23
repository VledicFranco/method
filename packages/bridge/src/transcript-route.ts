import { FastifyInstance } from 'fastify';
import type { SessionPool } from './pool.js';
import type { TranscriptReader } from './transcript-reader.js';

export function registerTranscriptRoutes(
  app: FastifyInstance,
  pool: SessionPool,
  transcriptReader: TranscriptReader,
): void {
  /**
   * GET /api/transcript/:id — JSON transcript for a specific session
   * Returns parsed turns from the Claude Code JSONL session log.
   */
  app.get<{ Params: { id: string } }>('/api/transcript/:id', async (request, reply) => {
    const { id } = request.params;

    let statusInfo;
    try {
      statusInfo = pool.status(id);
    } catch {
      return reply.status(404).send({ error: `Session not found: ${id}` });
    }

    const sessions = transcriptReader.listSessions(statusInfo.workdir);
    if (sessions.length === 0) {
      return reply.status(200).send({ turns: [], session_id: id });
    }

    // Find the session file whose modification time is closest to the bridge session
    const spawnTime = statusInfo.lastActivityAt.getTime();
    let bestMatch = sessions[0];
    let bestDelta = Infinity;

    for (const s of sessions) {
      const mtime = new Date(s.modifiedAt).getTime();
      const delta = Math.abs(mtime - spawnTime);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMatch = s;
      }
    }

    const turns = transcriptReader.getTranscript(bestMatch.file);

    return reply.status(200).send({
      session_id: id,
      turns,
      count: turns.length,
    });
  });

  /**
   * GET /transcripts — List available transcript sessions across all workdirs
   */
  app.get('/transcripts', async (_request, reply) => {
    const allSessions = pool.list();
    const workdirs = new Set(allSessions.map(s => s.workdir));
    const allTranscripts: Array<{
      workdir: string;
      file: string;
      modifiedAt: string;
      sizeBytes: number;
    }> = [];

    for (const wd of workdirs) {
      const sessions = transcriptReader.listSessions(wd);
      for (const s of sessions) {
        allTranscripts.push({ workdir: wd, ...s });
      }
    }

    return reply.status(200).send({
      transcripts: allTranscripts,
      count: allTranscripts.length,
    });
  });
}
