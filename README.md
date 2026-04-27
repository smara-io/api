# Smara — The Memory Layer for AI Agents

**Persistent memory for Claude, Cursor, Codex, LangChain, CrewAI, and any MCP or REST tool.**
Ebbinghaus decay scoring, contradiction detection, knowledge graphs, agent-scoped memory, vector search.
96% cheaper than mem0, Zep, and Letta.

[![npm](https://img.shields.io/npm/v/@smara/mcp-server)](https://www.npmjs.com/package/@smara/mcp-server)
[![PyPI](https://img.shields.io/pypi/v/smara)](https://pypi.org/project/smara/)
[![GitHub stars](https://img.shields.io/github/stars/smara-io/api)](https://github.com/smara-io/api)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io)

---

## Why Smara? 3 Reasons to Switch

1. **Ebbinghaus decay scoring** — memories fade naturally over time unless reinforced, just like human memory. No other memory API does this. Your agent stops hallucinating stale facts.
2. **One memory, every tool** — tell Claude Code you prefer Python, and Cursor already knows. Cross-platform memory via MCP or REST.
3. **$19/mo instead of $249+** — mem0 Pro costs $249/mo. Zep costs $475/mo. Smara Developer costs $19/mo with 200K memories. Same features, fraction of the price.

---

## AI Agent Memory Benchmark: Smara vs mem0 vs Zep vs Letta

| Feature | **Smara** | mem0 | Zep | Letta | agentmemory |
|---|:---:|:---:|:---:|:---:|:---:|
| Recall accuracy (top-5) | **94%** | 91% | 89% | 88% | 82% |
| Search latency (p95) | **38ms** | 65ms | 72ms | 95ms | 110ms |
| Cost / month (200K memories) | **$19** | $249 | $475 | $200 | self-host |
| Ebbinghaus memory decay | **Yes** | No | No | No | No |
| Contradiction detection | **Yes** | No | Partial | No | No |
| Knowledge graph | **Yes** | No | No | Yes | No |
| MCP native | **Yes** | No | No | No | No |
| Agent-scoped memory | **Yes** | No | Yes | Yes | No |
| Self-hostable | **Yes** | No | No | Yes | Yes |
| Cross-platform (Claude + Cursor + Codex) | **Yes** | No | No | No | No |

> Benchmarks run on 50K-memory dataset, Voyage AI embeddings, pgvector HNSW index. [Methodology →](https://smara.io/benchmarks)

---

## Quick Start: Python SDK (3 Lines)

```python
from smara import Smara

client = Smara(api_key="smara_...")
client.store("user_42", "Prefers Python for backend, TypeScript for frontend")
results = client.search("user_42", "language preferences")
```

## Install MCP Server in 30 Seconds (Claude Code / Cursor / Windsurf)

Add to your MCP config (`~/.claude/mcp_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "smara_your_key_here" }
  }
}
```

Restart your tool. Memory loads automatically at conversation start, new facts are stored silently.

---

## Feature List: Persistent Memory for LLM Agents

- **Ebbinghaus decay** — memories ranked by recency + reinforcement, not just similarity
- **Contradiction detection** — "prefers Python" vs "switched to Rust" flagged automatically
- **Knowledge graph** — connect related memories with typed, weighted edges and traverse them
- **Agent-scoped memory** — each AI agent gets its own namespace with attached skills
- **Semantic vector search** — pgvector HNSW with Voyage AI embeddings, sub-40ms p95
- **Cross-platform memory** — same memory across Claude Code, Cursor, Codex, LangChain, CrewAI
- **MCP native** — first-class Model Context Protocol support, one config line
- **Namespace isolation** — partition memories by project, team, or environment
- **Source tagging** — know which tool stored each fact
- **REST API** — three endpoints, works with any language or framework

---

## API Reference

All `/v1/*` endpoints require `Authorization: Bearer <API_KEY>`.

### Store a memory

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

**Smart storage:** duplicates (cosine >= 0.985) are merged. Contradictions (0.94-0.985) replace the old fact. Returns `"stored"`, `"duplicate"`, or `"replaced"`.

### Search memories (semantic search with decay ranking)

```bash
curl "https://api.smara.io/v1/memories/search?user_id=user_42&q=editor+preferences&limit=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Results are ranked by a blend of semantic similarity and Ebbinghaus decay. Relevant + recent beats relevant + old.

### Get LLM context

```bash
curl "https://api.smara.io/v1/users/user_42/context?q=preferences&top_n=5" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

Pre-formatted context string ready for system prompts.

Full API docs: [api.smara.io/docs](https://api.smara.io/docs)

---

## Pricing: mem0 Alternative at 92% Less

| | **Free** | **Developer** | **Pro** |
|---|:---:|:---:|:---:|
| Memories | 10,000 | 200,000 | 2,000,000 |
| Teams | 1 / 3 members | 3 / 10 members | Unlimited / 50 |
| AI Agents | 2 | 10 + 5 skills | Unlimited |
| Price | **$0** | **$19/mo** | **$99/mo** |

### Cost Comparison: AI Memory APIs

| Provider | Plan | Memories | Price/mo |
|---|---|---|---|
| **Smara** | Developer | 200K | **$19** |
| mem0 | Pro | 200K | $249 |
| Letta | Max | 200K | $200 |
| Zep | Flex+ | 200K | $475 |

[Sign up free](https://smara.io#signup) — no credit card required. [Pricing calculator →](https://smara.io#pricing)

---

## Migrate from mem0 to Smara (2 Minutes)

```python
# Before (mem0)
from mem0 import Memory
m = Memory()
m.add("Prefers dark mode", user_id="u1")

# After (Smara) — same pattern, lower cost
from smara import Smara
s = Smara(api_key="smara_...")
s.store("u1", "Prefers dark mode")
```

mem0 stores facts but never forgets stale ones. Smara's Ebbinghaus decay scoring means outdated preferences fade naturally — your agent always has the freshest context.

---

## Integrations: Works with Every AI Tool

| Tool | Method | Status |
|---|---|---|
| Claude Code | MCP server | Live |
| Cursor | MCP server | Live |
| Windsurf | MCP server | Live |
| OpenAI Codex | REST API | Live |
| CrewAI | Python SDK | [smara-crewai](integrations/crewai/) |
| LangChain | Python SDK | [smara-langchain](integrations/langchain/) |
| LlamaIndex | REST API | Live |
| Paperclip | Plugin | [paperclip-plugin](https://github.com/smara-io/paperclip-plugin) |

---

## Self-Hosting Smara (Docker)

```bash
git clone https://github.com/smara-io/api.git
cd api
VOYAGE_API_KEY=your-key docker compose up -d
```

API on `localhost:3011`, Postgres on `localhost:5433`. Auto-migrates on startup.

Manual setup: Node.js 20+, PostgreSQL 15+ with pgvector, Voyage AI key. See [self-hosting docs](https://smara.io/docs/self-hosting).

---

## Architecture

```
Client (Claude Code / Cursor / Codex / LangChain / REST)
  │
  ▼
Fastify API (Node.js)
  │
  ├── Auth middleware (API key + tenant isolation)
  ├── /v1/memories     — store, search, delete (vector + Ebbinghaus decay)
  ├── /v1/graph        — connect, traverse, related (recursive CTE)
  ├── /v1/agents       — CRUD agents, attach skills, agent-scoped memory
  └── /v1/users        — formatted LLM context
  │
  ▼
PostgreSQL + pgvector
  ├── memories (embedding column, HNSW index)
  ├── memory_edges (knowledge graph)
  ├── agents, skills, agent_skills
  └── Ebbinghaus decay computed at query time
  │
Voyage AI (embeddings)
```

---

## Links

- **Website:** [smara.io](https://smara.io)
- **API Docs:** [api.smara.io/docs](https://api.smara.io/docs)
- **MCP Server:** [@smara/mcp-server on npm](https://www.npmjs.com/package/@smara/mcp-server)
- **Python SDK:** [smara on PyPI](https://pypi.org/project/smara/)
- **Blog:** [How Ebbinghaus Forgetting Curves Make AI Agents Smarter](https://dev.to/smara/how-ebbinghaus-forgetting-curves-make-ai-agents-smarter-ef3)
- **Pricing Calculator:** [smara.io/#pricing](https://smara.io#pricing)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [@parallelromb](https://twitter.com/parallelromb) | [smara.io](https://smara.io) | [Twitter @SmaraMemo](https://twitter.com/SmaraMemo)
