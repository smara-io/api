const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const tenants = await pool.query('SELECT id, name, plan, memory_limit FROM tenants');
  console.log('TENANTS:', JSON.stringify(tenants.rows));

  const mems = await pool.query('SELECT COUNT(*) as count FROM memories');
  console.log('MEMORIES:', mems.rows[0].count);

  // Generate new API key
  const rawKey = 'smara_' + crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const tenantId = tenants.rows[0].id;

  await pool.query(
    'INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3)',
    [tenantId, keyHash, 'Lumen/Sage dogfooding']
  );
  console.log('NEW_API_KEY:', rawKey);

  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
