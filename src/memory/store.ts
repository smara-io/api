import { pool } from '../db/pool.js';
import { embed } from '../embed/voyage.js';

// ── Similarity band semantics (cosine similarity) ────────────────────────────
//  ≥ 0.985  → TRUE DUPLICATE — same fact, skip storage
//  0.94–0.985 → CONTRADICTION — store new, soft-delete old (valid_until = NOW())
//  < 0.94   → NEW FACT — store alongside existing memories
const DUPLICATE_THRESHOLD = 0.985;
const CONTRADICTION_LOW = 0.94;

export interface StoreResult {
  id: string;
  action: 'stored' | 'duplicate' | 'replaced';
  replacedId?: string;
}

export async function storeMemory(
  tenantId: string,
  userId: string,
  fact: string,
  importance: number = 0.5,
  source: string = 'api',
  namespace: string = 'default',
  teamId?: string,
  visibility?: string
): Promise<StoreResult> {
  const embedding = await embed(fact);
  const vec = `[${embedding.join(',')}]`;

  // When teamId is set, automatically use team visibility and scope dedup to team
  const effectiveVisibility = teamId ? 'team' : (visibility ?? 'private');

  // Check for near-duplicate or contradiction in active memories (scoped by namespace)
  // For team memories, scope dedup to (team_id, namespace) instead of (user_id, namespace)
  let dedupSql: string;
  let dedupParams: unknown[];
  if (teamId) {
    dedupSql = `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE tenant_id = $2
         AND team_id = $3
         AND namespace = $4
         AND valid_until IS NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`;
    dedupParams = [vec, tenantId, teamId, namespace];
  } else {
    dedupSql = `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE tenant_id = $2
         AND user_id = $3
         AND namespace = $4
         AND valid_until IS NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`;
    dedupParams = [vec, tenantId, userId, namespace];
  }

  const { rows } = await pool.query<{ id: string; similarity: number }>(dedupSql, dedupParams);

  const nearest = rows[0];

  if (nearest && nearest.similarity >= DUPLICATE_THRESHOLD) {
    return { id: nearest.id, action: 'duplicate' };
  }

  let replacedId: string | undefined;

  if (nearest && nearest.similarity >= CONTRADICTION_LOW) {
    // Soft-delete the contradicting memory
    await pool.query(
      `UPDATE memories SET valid_until = NOW() WHERE id = $1`,
      [nearest.id]
    );
    replacedId = nearest.id;
  }

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO memories (tenant_id, user_id, fact, embedding, importance, decay_score, source, namespace, team_id, visibility)
     VALUES ($1, $2, $3, $4::vector, $5, 1.0, $6, $7, $8, $9)
     RETURNING id`,
    [tenantId, userId, fact, vec, importance, source, namespace, teamId ?? null, effectiveVisibility]
  );

  return {
    id: insertResult.rows[0].id,
    action: replacedId ? 'replaced' : 'stored',
    replacedId,
  };
}

export async function deleteMemory(
  tenantId: string,
  memoryId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE memories SET valid_until = NOW()
     WHERE id = $1 AND tenant_id = $2 AND valid_until IS NULL`,
    [memoryId, tenantId]
  );
  return (rowCount ?? 0) > 0;
}
