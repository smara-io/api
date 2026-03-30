# Smara -- Memory API for AI Agents

Persistent, searchable memory for AI agents with Ebbinghaus decay scoring, contradiction detection, and vector search.

[![Website](https://img.shields.io/badge/website-smara.io-blue)](https://smara.io)
[![API Docs](https://img.shields.io/badge/docs-api.smara.io-green)](https://api.smara.io/docs)

---

## Features

- **3 API calls** -- store, search, and context. That's it.
- **Ebbinghaus decay scoring** -- memories fade over time; `decay_score` reflects current relevance.
- **Automatic contradiction detection** -- cosine similarity > 0.94 flags a contradiction and soft-deletes the older memory.
- **Automatic duplicate detection** -- cosine similarity > 0.985 skips the write entirely.
- **Vector search** -- powered by Voyage AI embeddings (1024-dim) with pgvector.
- **Multi-tenant** -- isolated per API key; each key scopes to one tenant.
- **Usage tracking** -- `GET /v1/usage` returns current period consumption and limits.

---

## Quick Start

All endpoints require an `Authorization: Bearer <API_KEY>` header.

### Store a memory

```bash
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_42",
    "fact": "Prefers dark mode",
    "importance": 0.7
  }'
```

Response:

```json
{
  "id": "mem_abc123",
  "user_id": "user_42",
  "fact": "Prefers dark mode",
  "importance": 0.7,
  "decay_score": 0.7,
  "created_at": "2026-03-30T12:00:00Z"
}
```

### Search memories

```bash
curl "https://api.smara.io/v1/memories/search?user_id=user_42&q=editor+preferences&limit=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Response:

```json
{
  "memories": [
    {
      "id": "mem_abc123",
      "fact": "Prefers dark mode",
      "importance": 0.7,
      "decay_score": 0.65,
      "similarity": 0.87
    }
  ]
}
```

### Get user context

Returns the most relevant memories for a query, pre-ranked by decay and similarity.

```bash
curl "https://api.smara.io/v1/users/user_42/context?q=preferences" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Response:

```json
{
  "user_id": "user_42",
  "context": [
    {
      "id": "mem_abc123",
      "fact": "Prefers dark mode",
      "decay_score": 0.65,
      "similarity": 0.87
    }
  ]
}
```

### Check usage

```bash
curl https://api.smara.io/v1/usage \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Response:

```json
{
  "plan": "developer",
  "period": "2026-03",
  "api_calls_used": 4820,
  "api_calls_limit": 200000
}
```

### Delete a memory

```bash
curl -X DELETE https://api.smara.io/v1/memories/mem_abc123 \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Response:

```json
{
  "deleted": true
}
```

---

## Pricing

| Plan | API calls / month | Price |
|------|-------------------|-------|
| Free | 10,000 | $0 |
| Developer | 200,000 | $19/mo |
| Pro | 2,000,000 + overage | $99/mo |

---

## Self-Hosting

Smara can be self-hosted. Requirements:

- **PostgreSQL 15+** with the **pgvector** extension
- **Voyage AI API key** for embeddings
- **Node.js 20+**

```bash
git clone https://github.com/smara-io/api.git
cd api
npm install
cp .env.example .env   # configure DATABASE_URL, VOYAGE_API_KEY
npm run db:migrate
npm run build && npm start
```

---

## Links

- Website: [smara.io](https://smara.io)
- API Docs: [api.smara.io/docs](https://api.smara.io/docs)
- Twitter: [@SmaraMemo](https://twitter.com/SmaraMemo)
- GitHub: [github.com/smara-io/api](https://github.com/smara-io/api)

---

## License

MIT
