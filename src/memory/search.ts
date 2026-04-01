import { pool } from '../db/pool.js';
import { embed } from '../embed/voyage.js';
import { ebbinghaus, blendScore } from './decay.js';

export interface MemoryResult {
  id: string;
  fact: string;
  importance: number;
  decay_score: number;
  similarity: number;
  score: number;
  source: string;
  namespace: string;
  created_at: string;
}

export async function searchMemories(
  tenantId: string,
  userId: string,
  query: string,
  limit: number = 10,
  source?: string,
  namespace: string = 'default'
): Promise<MemoryResult[]> {
  const embedding = await embed(query);
  const vec = `[${embedding.join(',')}]`;

  let sql = `SELECT id, fact, importance, created_at, source, namespace,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM memories
             WHERE tenant_id = $2
               AND user_id = $3
               AND namespace = $4
               AND valid_until IS NULL`;
  const params: unknown[] = [vec, tenantId, userId, namespace];

  if (source) {
    params.push(source);
    sql += ` AND source = $${params.length}`;
  }

  params.push(limit * 2);
  sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length}`;

  const { rows } = await pool.query<{
    id: string;
    fact: string;
    importance: number;
    created_at: Date;
    source: string;
    namespace: string;
    similarity: number;
  }>(sql, params);

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
        source: row.source,
        namespace: row.namespace,
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

/** Return top-N memories by decay score alone (no query needed, no Voyage API call) */
export async function getRecentMemories(
  tenantId: string,
  userId: string,
  limit: number = 5,
  namespace: string = 'default'
): Promise<MemoryResult[]> {
  const { rows } = await pool.query<{
    id: string;
    fact: string;
    importance: number;
    created_at: Date;
    source: string;
    namespace: string;
  }>(
    `SELECT id, fact, importance, created_at, source, namespace
     FROM memories
     WHERE tenant_id = $1
       AND user_id = $2
       AND namespace = $3
       AND valid_until IS NULL
     ORDER BY created_at DESC
     LIMIT $4`,
    [tenantId, userId, namespace, limit * 2]
  );

  return rows
    .map(row => {
      const decay = ebbinghaus(row.created_at, row.importance);
      return {
        id: row.id,
        fact: row.fact,
        importance: row.importance,
        decay_score: parseFloat(decay.toFixed(4)),
        similarity: 1,  // no vector search — full relevance assumed
        score: parseFloat(decay.toFixed(4)),
        source: row.source,
        namespace: row.namespace,
        created_at: row.created_at.toISOString(),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function getContext(
  tenantId: string,
  userId: string,
  query: string | undefined,
  topN: number = 5,
  namespace: string = 'default'
): Promise<{ memories: MemoryResult[]; context: string }> {
  const memories = query
    ? await searchMemories(tenantId, userId, query, topN, undefined, namespace)
    : await getRecentMemories(tenantId, userId, topN, namespace);

  const context = memories.length === 0
    ? 'No relevant memories found.'
    : memories
        .map((m, i) => `[${i + 1}] (importance: ${m.importance}, decay: ${m.decay_score}, source: ${m.source}) ${m.fact}`)
        .join('\n');

  return { memories, context };
}
