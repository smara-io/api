<div align="center">

```
 ___  __  __    __    ____    __   
/ __)(  \/  )  /__\  (  _ \  /__\  
\__ \ )    (  /(__)\  )   / /(__)\
(___/(_/\/\_)(__)(__)(\_)\_)(__)(__)
```

### Your AI tools forget everything. Smara remembers.

**Persistent, cross-platform memory for AI agents.**<br>
Ebbinghaus decay scoring. Contradiction detection. Deduplication. Vector search.<br>
One memory pool shared across every tool you use.

[![Website](https://img.shields.io/badge/website-smara.io-blue?style=for-the-badge)](https://smara.io)
[![API Docs](https://img.shields.io/badge/docs-api.smara.io-green?style=for-the-badge)](https://api.smara.io/docs)
[![npm](https://img.shields.io/npm/v/@smara/mcp-server?style=for-the-badge)](https://www.npmjs.com/package/@smara/mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=for-the-badge)](LICENSE)

[Get Started](#-quick-start) | [API Reference](#-api-reference) | [Self-Host](#-self-hosting) | [Pricing](#-pricing)

</div>

---

## The Problem

Every AI tool has its own isolated memory. Tell Claude Code you prefer Python -- switch to Cursor, it has no idea. Open Codex -- starts from scratch.

**Smara fixes this.** One memory pool, shared across every AI tool. Memories are ranked by semantic relevance and Ebbinghaus decay -- recent, frequently accessed facts stay strong while old trivia fades naturally.

```
                            How Smara Works
  
  Claude Code ──┐                              ┌── Ranked Results
  Cursor ───────┤                              │
  Windsurf ─────┼──▶  MCP / REST  ──▶  Smara  ├── Context for LLMs
  Codex ────────┤      Protocol        Engine  │
  Any Agent ────┘                              └── Contradiction Alerts
                                                  
                         ┌─────────────────┐
                         │  Vector Search   │
                         │  Ebbinghaus Decay│
                         │  Deduplication   │
                         │  Source Tagging  │
                         └─────────────────┘
```

---

## Features at a Glance

| | Feature | Description |
|---|---|---|
| **Decay Scoring** | Ebbinghaus forgetting curve | Recent, important, frequently accessed memories rank highest |
| **Contradiction Detection** | Automatic conflict resolution | New facts replace outdated ones (cosine 0.94-0.985) |
| **Deduplication** | Near-duplicate suppression | Exact or near-identical facts are merged (cosine >= 0.985) |
| **Vector Search** | Semantic similarity via Voyage AI | Natural language queries, not keyword matching |
| **Source Tagging** | Cross-platform provenance | Know which tool stored each memory |
| **Namespace Isolation** | Logical partitioning | Separate work, personal, and project memories |
| **MCP + REST** | Dual protocol support | Works with any MCP client or HTTP-capable tool |
| **Blended Ranking** | Similarity x Decay scoring | Results ranked by relevance *and* freshness |

---

## Supported Tools

<table>
<tr>
<td align="center"><strong>Claude Code</strong><br><sub>MCP Server</sub></td>
<td align="center"><strong>Cursor</strong><br><sub>MCP Server</sub></td>
<td align="center"><strong>Windsurf</strong><br><sub>MCP Server</sub></td>
<td align="center"><strong>Codex</strong><br><sub>REST API</sub></td>
<td align="center"><strong>CrewAI</strong><br><sub>Python SDK</sub></td>
<td align="center"><strong>LangChain</strong><br><sub>Python SDK</sub></td>
</tr>
</table>

> Any tool that speaks MCP or REST works with Smara out of the box.

---

## Quick Start

### 1. Get an API key

```bash
curl -X POST https://api.smara.io/v1/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

```json
{
  "api_key": "smara_...",
  "message": "Save this API key -- it cannot be recovered."
}
```

Or sign up at [smara.io](https://smara.io#signup).

### 2. Add to your AI tools

<details>
<summary><strong>Claude Code / Cursor / Windsurf (MCP)</strong></summary>

Add to your MCP config (`~/.claude/mcp_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": {
      "SMARA_API_KEY": "smara_your_key_here"
    }
  }
}
```

Restart your tool. Memory is automatic -- context loads at conversation start, new facts are stored silently.

</details>

<details>
<summary><strong>Any tool (REST API)</strong></summary>

Three endpoints. That's it: **store**, **search**, and **context**. See the [API Reference](#-api-reference) below.

</details>

---

## API Reference

> All `/v1/*` endpoints require `Authorization: Bearer <API_KEY>`.

### `POST` /v1/memories -- Store a memory

```bash
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_42",
    "fact": "Prefers Python over TypeScript for backend work",
    "importance": 0.8,
    "source": "claude-code",
    "namespace": "default"
  }'
```

```json
{
  "action": "stored",
  "id": "a1b2c3d4-...",
  "source": "claude-code",
  "namespace": "default"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | Your user identifier |
| `fact` | string | Yes | The fact to store (1-2000 chars) |
| `importance` | number | No | 0.0-1.0, default 0.5 |
| `source` | string | No | Which tool stored this (e.g., "claude-code", "cursor") |
| `namespace` | string | No | Partition memories (default: "default") |

**Smart storage:**
- **Duplicate** (cosine >= 0.985): returns existing memory, no duplicate created
- **Contradiction** (cosine 0.94-0.985): soft-deletes old fact, stores new one
- Returns `"action": "stored"`, `"duplicate"`, or `"replaced"`

### `GET` /v1/memories/search -- Search memories

```bash
curl "https://api.smara.io/v1/memories/search?user_id=user_42&q=editor+preferences&limit=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

```json
{
  "results": [
    {
      "id": "a1b2c3d4-...",
      "fact": "Prefers Python over TypeScript for backend work",
      "importance": 0.8,
      "decay_score": 0.97,
      "similarity": 0.88,
      "score": 0.91,
      "source": "claude-code",
      "namespace": "default",
      "created_at": "2026-03-30T12:00:00Z"
    }
  ]
}
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | Your user identifier |
| `q` | string | Yes | Natural language search query |
| `limit` | number | No | 1-50, default 10 |
| `source` | string | No | Filter by source tool |
| `namespace` | string | No | Filter by namespace |

### `GET` /v1/users/:id/context -- Get user context

Pre-formatted context for LLM system prompts. Works with or without a query.

```bash
# With query (semantic search + decay)
curl "https://api.smara.io/v1/users/user_42/context?q=preferences&top_n=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"

# Without query (top memories by decay score)
curl "https://api.smara.io/v1/users/user_42/context?top_n=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

```json
{
  "context": "[1] (importance: 0.8, decay: 0.97, source: claude-code) Prefers Python over TypeScript...",
  "memories": [...]
}
```

### `DELETE` /v1/memories/:id -- Delete a memory

```bash
curl -X DELETE https://api.smara.io/v1/memories/<memory_id> \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Returns `204 No Content` on success.

### `GET` /v1/usage -- Check usage

```bash
curl https://api.smara.io/v1/usage \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

```json
{
  "plan": "free",
  "memory_limit": 10000,
  "memories_used": 250,
  "memories_remaining": 9750
}
```

---

## How It Works

<table>
<tr>
<td width="50%">

### Ebbinghaus Decay

Every memory's relevance decays over time using the Ebbinghaus forgetting curve. High-importance memories decay slowly; low-importance ones fade fast. Memories that are frequently accessed get reinforced.

</td>
<td width="50%">

### Blended Ranking

Search results are ranked by a blend of semantic similarity and temporal decay. Relevant + recent beats relevant + old.

</td>
</tr>
<tr>
<td width="50%">

### Cross-Platform Source Tagging

Every memory is tagged with its source tool. A fact stored via Claude Code is instantly available in Cursor, Codex, or any connected tool. Filter by source or see everything.

</td>
<td width="50%">

### Namespace Isolation

Partition memories by namespace (e.g., "work", "personal", "test"). Deduplication and contradiction detection are scoped per namespace.

</td>
</tr>
</table>

---

## MCP Server

The MCP server (`@smara/mcp-server`) provides automatic memory for MCP-compatible tools.

```bash
npx -y @smara/mcp-server
```

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `SMARA_API_KEY` | Yes | Your API key |
| `SMARA_API_URL` | No | API URL (default: `https://api.smara.io`) |
| `SMARA_USER_ID` | No | Default user ID for all operations |
| `SMARA_SOURCE` | No | Source tag (default: "mcp") |
| `SMARA_NAMESPACE` | No | Default namespace |

**Auto-memory behavior:**

1. **On start** -- loads stored context automatically
2. **During conversation** -- silently stores new facts
3. **On command** -- "remember this" / "forget that" for explicit store/delete

See [@smara/mcp-server on npm](https://www.npmjs.com/package/@smara/mcp-server).

---

## Integrations

| Tool | Method | Status |
|------|--------|--------|
| Claude Code | MCP server | Live |
| Cursor | MCP server | Live |
| Windsurf | MCP server | Live |
| CrewAI | Python SDK | [smara-crewai](integrations/crewai/) |
| LangChain | Python SDK | [smara-langchain](integrations/langchain/) |
| Paperclip | Plugin | [paperclip-plugin](https://github.com/smara-io/paperclip-plugin) |
| OpenAI / Codex | REST API | Use endpoints directly |

---

## Self-Hosting

### Docker (recommended)

```bash
git clone https://github.com/smara-io/api.git
cd api
VOYAGE_API_KEY=your-key docker compose up -d
```

API runs on `localhost:3011`, Postgres on `localhost:5433`.

### Manual

Requirements: Node.js 20+, PostgreSQL 15+ with pgvector, Voyage AI API key.

```bash
git clone https://github.com/smara-io/api.git
cd api
npm install
npm run build

# Set environment variables
export DATABASE_URL=postgresql://user:pass@localhost:5432/smara
export VOYAGE_API_KEY=your-key

npm start
```

The API auto-migrates on startup (creates tables, indexes, extensions).

---

## Pricing

| Plan | Memories | Price |
|------|----------|-------|
| **Free** | 10,000 | $0 |
| **Developer** | 200,000 | $19/mo |
| **Pro** | 2,000,000 + $0.50/10K overage | $99/mo |

[Sign up free](https://smara.io#signup) -- no credit card required.

---

## Links

- **Website:** [smara.io](https://smara.io)
- **API Docs:** [api.smara.io/docs](https://api.smara.io/docs)
- **MCP Server:** [npm @smara/mcp-server](https://www.npmjs.com/package/@smara/mcp-server)
- **Blog:** [How Ebbinghaus Forgetting Curves Make AI Agents Smarter](https://dev.to/smara/how-ebbinghaus-forgetting-curves-make-ai-agents-smarter-ef3)
- **Twitter:** [@SmaraMemo](https://twitter.com/SmaraMemo)

---

<div align="center">

### Community

Questions? Ideas? Feature requests?<br>
[Open an issue](https://github.com/smara-io/api/issues) or reach out on [Twitter](https://twitter.com/SmaraMemo).

If Smara is useful to you, consider giving it a star -- it helps others discover the project.

**MIT License** -- Built by [@parallelromb](https://github.com/parallelromb)

</div>
