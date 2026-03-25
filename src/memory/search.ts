import { pool } from '../db/pool.js';
import { embed } from '../embed/openai.js';
import { ebbinghaus, blendScore } from './decay.js';

export interface MemoryResult {
  id: string;
  fact: string;
  importance: number;
  decay_score: number;
  similarity: number;
  score: number;
  created_at: string;
}

export async function searchMemories(
  tenantId: string,
  userId: string,
  query: string,
  limit: number = 10
): Promise<MemoryResult[]> {
  const embedding = await embed(query);
  const vec = `[${embedding.join(',')}]`;

  const { rows } = await pool.query<{
    id: string;
    fact: string;
    importance: number;
    created_at: Date;
    similarity: number;
  }>(
    `SELECT id, fact, importance, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM memories
     WHERE tenant_id = $2
       AND user_id = $3
       AND valid_until IS NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $4`,
    [vec, tenantId, userId, limit * 2]  // over-fetch to re-rank by decay
  );

  // Re-rank using Ebbinghaus decay blend
  const reranked = rows
    .map(row => {
      const decay = ebbinghaus(row.created_at, row.importance);
      return {
        id: row.id,
        fact: row.fact,
        importance: row.importance,
        decay_score: parseFloat(decay.toFixed(4)),
        similarity: parseFloat(row.similarity.toFixed(4)),
        score: parseFloat(blendScore(row.similarity, decay).toFixed(4)),
        created_at: row.created_at.toISOString(),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Update last_accessed_at + access_count in background
  const ids = reranked.map(r => r.id);
  if (ids.length > 0) {
    pool.query(
      `UPDATE memories
       SET last_accessed_at = NOW(),
           access_count = access_count + 1,
           decay_score = 1 - (embedding <=> $1::vector)
       WHERE id = ANY($2::uuid[])`,
      [vec, ids]
    ).catch(() => {/* non-critical */});
  }

  return reranked;
}

export async function getContext(
  tenantId: string,
  userId: string,
  query: string,
  topN: number = 5
): Promise<{ memories: MemoryResult[]; context: string }> {
  const memories = await searchMemories(tenantId, userId, query, topN);

  const context = memories.length === 0
    ? 'No relevant memories found.'
    : memories
        .map((m, i) => `[${i + 1}] (importance: ${m.importance}, decay: ${m.decay_score}) ${m.fact}`)
        .join('\n');

  return { memories, context };
}
