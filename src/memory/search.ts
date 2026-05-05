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

const RRF_K = 60;
const CANDIDATE_K = 30;

function rrfFuse(
  vectorRows: { id: string; rank: number }[],
  bm25Rows: { id: string; rank: number }[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const r of vectorRows) {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + r.rank));
  }
  for (const r of bm25Rows) {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + r.rank));
  }
  return scores;
}

function buildWhereClause(
  tenantId: string,
  userId: string,
  namespace: string,
  source: string | undefined,
  teamId: string | undefined,
  includeTeam: boolean,
  params: unknown[]
): { where: string } {
  let where: string;

  if (includeTeam && teamId) {
    params.push(tenantId, userId, namespace, teamId);
    const ti = params.length - 3, ui = params.length - 2, ni = params.length - 1, tmi = params.length;
    where = `tenant_id = $${ti} AND namespace = $${ni} AND valid_until IS NULL
             AND ((user_id = $${ui} AND team_id IS NULL) OR (team_id = $${tmi} AND visibility = 'team'))`;
  } else {
    params.push(tenantId, userId, namespace);
    const ti = params.length - 2, ui = params.length - 1, ni = params.length;
    where = `tenant_id = $${ti} AND user_id = $${ui} AND namespace = $${ni} AND valid_until IS NULL`;
  }

  if (source) {
    params.push(source);
    where += ` AND source = $${params.length}`;
  }

  return { where };
}

export async function searchMemories(
  tenantId: string,
  userId: string,
  query: string,
  limit: number = 10,
  source?: string,
  namespace: string = 'default',
  teamId?: string,
  includeTeam: boolean = false
): Promise<MemoryResult[]> {
  const embedding = await embed(query);
  const vec = `[${embedding.join(',')}]`;

  // Build shared WHERE clause params
  const vectorParams: unknown[] = [vec];
  const { where: vectorWhere } = buildWhereClause(tenantId, userId, namespace, source, teamId, includeTeam, vectorParams);
  vectorParams.push(CANDIDATE_K);

  const vectorSql = `SELECT id, fact, importance, created_at, source, namespace,
                            1 - (embedding <=> $1::vector) AS similarity
                     FROM memories
                     WHERE ${vectorWhere}
                     ORDER BY embedding <=> $1::vector
                     LIMIT $${vectorParams.length}`;

  // BM25 full-text search (gracefully degrades if fact_tsv column doesn't exist yet)
  const bm25Params: unknown[] = [query];
  const { where: bm25Where } = buildWhereClause(tenantId, userId, namespace, source, teamId, includeTeam, bm25Params);
  bm25Params.push(CANDIDATE_K);

  const bm25Sql = `SELECT id, fact, importance, created_at, source, namespace,
                          ts_rank_cd(fact_tsv, plainto_tsquery('english', $1)) AS bm25_score
                   FROM memories
                   WHERE ${bm25Where}
                     AND fact_tsv @@ plainto_tsquery('english', $1)
                   ORDER BY bm25_score DESC
                   LIMIT $${bm25Params.length}`;

  type Row = {
    id: string;
    fact: string;
    importance: number;
    created_at: Date;
    source: string;
    namespace: string;
    similarity?: number;
    bm25_score?: number;
  };

  // Run vector + BM25 in parallel; BM25 fails gracefully if column missing
  const [vectorResult, bm25Result] = await Promise.all([
    pool.query<Row>(vectorSql, vectorParams),
    pool.query<Row>(bm25Sql, bm25Params).catch(() => ({ rows: [] as Row[] })),
  ]);

  const vectorRows = vectorResult.rows;
  const bm25Rows = bm25Result.rows;

  // If BM25 returned results, use RRF fusion; otherwise fall back to vector-only
  const allRows = new Map<string, Row>();
  for (const r of vectorRows) allRows.set(r.id, r);
  for (const r of bm25Rows) if (!allRows.has(r.id)) allRows.set(r.id, r);

  let ranked: { id: string; rrfScore: number }[];

  if (bm25Rows.length > 0) {
    const rrfScores = rrfFuse(
      vectorRows.map((r, i) => ({ id: r.id, rank: i + 1 })),
      bm25Rows.map((r, i) => ({ id: r.id, rank: i + 1 }))
    );
    ranked = [...rrfScores.entries()]
      .map(([id, score]) => ({ id, rrfScore: score }))
      .sort((a, b) => b.rrfScore - a.rrfScore);
  } else {
    ranked = vectorRows.map((r, i) => ({ id: r.id, rrfScore: 1 / (RRF_K + i + 1) }));
  }

  // Apply Ebbinghaus decay as a mild multiplier on RRF-ranked results
  const reranked = ranked
    .slice(0, limit * 2)
    .map(({ id, rrfScore }) => {
      const row = allRows.get(id)!;
      const decay = ebbinghaus(row.created_at, row.importance);
      const similarity = row.similarity ?? 0;
      // RRF score is the primary signal; decay acts as a gentle tiebreaker (0.85 + 0.15*decay)
      const finalScore = rrfScore * (0.85 + 0.15 * decay);
      return {
        id: row.id,
        fact: row.fact,
        importance: row.importance,
        decay_score: parseFloat(decay.toFixed(4)),
        similarity: parseFloat(similarity.toFixed(4)),
        score: parseFloat(finalScore.toFixed(6)),
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
  namespace: string = 'default',
  teamId?: string,
  includeTeam: boolean = false
): Promise<MemoryResult[]> {
  let sql: string;
  let params: unknown[];

  if (includeTeam && teamId) {
    sql = `SELECT id, fact, importance, created_at, source, namespace
       FROM memories
       WHERE tenant_id = $1
         AND namespace = $3
         AND valid_until IS NULL
         AND (
           (user_id = $2 AND team_id IS NULL)
           OR (team_id = $4 AND visibility = 'team')
         )
       ORDER BY created_at DESC
       LIMIT $5`;
    params = [tenantId, userId, namespace, teamId, limit * 2];
  } else {
    sql = `SELECT id, fact, importance, created_at, source, namespace
       FROM memories
       WHERE tenant_id = $1
         AND user_id = $2
         AND namespace = $3
         AND valid_until IS NULL
       ORDER BY created_at DESC
       LIMIT $4`;
    params = [tenantId, userId, namespace, limit * 2];
  }

  const { rows } = await pool.query<{
    id: string;
    fact: string;
    importance: number;
    created_at: Date;
    source: string;
    namespace: string;
  }>(sql, params);

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
  namespace: string = 'default',
  teamId?: string,
  includeTeam: boolean = false
): Promise<{ memories: MemoryResult[]; context: string }> {
  const memories = query
    ? await searchMemories(tenantId, userId, query, topN, undefined, namespace, teamId, includeTeam)
    : await getRecentMemories(tenantId, userId, topN, namespace, teamId, includeTeam);

  const context = memories.length === 0
    ? 'No relevant memories found.'
    : memories
        .map((m, i) => `[${i + 1}] (importance: ${m.importance}, decay: ${m.decay_score}, source: ${m.source}) ${m.fact}`)
        .join('\n');

  return { memories, context };
}
