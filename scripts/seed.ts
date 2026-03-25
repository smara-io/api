/**
 * Smara API — First-run seed script
 *
 * Creates the initial tenant and API key.
 * Run once after deploying the schema:
 *
 *   DATABASE_URL=... npx tsx scripts/seed.ts
 *   DATABASE_URL=... npx tsx scripts/seed.ts --name "My Tenant"
 *
 * Outputs the raw API key — store it securely, it cannot be recovered.
 */

import pg from 'pg';
import { createHash, randomBytes } from 'crypto';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function generateApiKey(): string {
  // Format: smara_<32 random hex bytes>
  return `smara_${randomBytes(32).toString('hex')}`;
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

const tenantName = process.argv.includes('--name')
  ? process.argv[process.argv.indexOf('--name') + 1]
  : 'Default Tenant';

const client = await pool.connect();

try {
  await client.query('BEGIN');

  // Create tenant
  const { rows: tenantRows } = await client.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
    [tenantName]
  );
  const tenantId = tenantRows[0].id;

  // Generate and store API key
  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);

  await client.query(
    `INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3)`,
    [tenantId, keyHash, 'Initial key']
  );

  await client.query('COMMIT');

  console.log('\n✓ Seed complete\n');
  console.log(`Tenant:   ${tenantName}`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`\nAPI Key (save this — shown once):\n`);
  console.log(`  ${rawKey}\n`);
  console.log('Test it:');
  console.log(`  curl -X POST https://your-railway-url/v1/memories \\`);
  console.log(`    -H "Authorization: Bearer ${rawKey}" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"user_id":"user_1","fact":"The user prefers dark mode","importance":0.7}'`);
  console.log('');

} catch (err) {
  await client.query('ROLLBACK');
  console.error('Seed failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
