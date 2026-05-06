# Smara SDK Quickstart: Add AI Memory in 5 Minutes

*By [Sri Panchavati](https://parallelromb.dev) -- April 2026 -- 10 min read*

Most AI tools have no memory. Every session starts from zero -- your agent forgets preferences, context, decisions, and everything it learned five minutes ago. Smara gives any AI tool persistent, searchable, decay-scored memory through a simple REST API.

This guide gets you from zero to working memory in under five minutes. Pick your language, copy the examples, and ship.

---

## API Overview

All endpoints live under `https://api.smara.io/v1`. Authenticate with a Bearer token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /v1/memories | Store a new memory |
| GET | /v1/memories | List all memories |
| POST | /v1/memories/search | Semantic search |
| DELETE | /v1/memories/:id | Delete a memory |

---

## Installation & Setup

### 1. Get Your API Key

Sign up at [smara.io](https://smara.io) and grab your key from the dashboard. Free tier gives you 100 memories, no credit card required.

### 2. Set Your Environment Variable

```bash
# Add to your .env or shell profile
export SMARA_API_KEY="smr_xxxxxxxxxxxx"
```

### 3. (Optional) MCP Server for IDE Integration

If you want automatic memory in Claude Code, Cursor, or Windsurf:

```bash
npx @smara/mcp-server --init
```

---

## JavaScript / TypeScript

No SDK package needed -- use plain `fetch`. Works in Node.js 18+, Deno, Bun, and browsers.

### Store a Memory

```javascript
const API = "https://api.smara.io/v1";
const KEY = process.env.SMARA_API_KEY;

const res = await fetch(`${API}/memories`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    user_id: "user-123",
    content: "Prefers dark mode and Vim keybindings in all editors",
    tags: ["preferences", "editor"],
    importance: 0.8,
    namespace: "my-app",
  }),
});

const memory = await res.json();
console.log(memory);
// { id: "mem_abc123", content: "Prefers dark mode...", score: 0.8, ... }
```

### Search Memories

```javascript
const results = await fetch(`${API}/memories/search`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    user_id: "user-123",
    q: "editor preferences",
    top_n: 5,
    namespace: "my-app",
  }),
}).then(r => r.json());

console.log(results.memories);
// [{ id: "mem_abc123", content: "Prefers dark mode...", score: 0.92, decay: 0.98 }]
```

### List All Memories

```javascript
const all = await fetch(
  `${API}/memories?user_id=user-123&namespace=my-app&limit=20`,
  { headers: { "Authorization": `Bearer ${KEY}` } }
).then(r => r.json());

console.log(`${all.total} memories found`);
```

### Delete a Memory

```javascript
await fetch(`${API}/memories/mem_abc123`, {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${KEY}` },
});
// 204 No Content
```

---

## Python

Uses the `requests` library. Install with `pip install requests` if you don't have it.

### Store a Memory

```python
import os, requests

API = "https://api.smara.io/v1"
KEY = os.environ["SMARA_API_KEY"]
HEADERS = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

res = requests.post(f"{API}/memories", headers=HEADERS, json={
    "user_id": "user-123",
    "content": "Prefers dark mode and Vim keybindings in all editors",
    "tags": ["preferences", "editor"],
    "importance": 0.8,
    "namespace": "my-app",
})

memory = res.json()
print(memory)
# {"id": "mem_abc123", "content": "Prefers dark mode...", "score": 0.8, ...}
```

### Search Memories

```python
results = requests.post(f"{API}/memories/search", headers=HEADERS, json={
    "user_id": "user-123",
    "q": "editor preferences",
    "top_n": 5,
    "namespace": "my-app",
}).json()

for m in results["memories"]:
    print(f"{m['score']:.2f}  {m['content']}")
# 0.92  Prefers dark mode and Vim keybindings in all editors
```

### List All Memories

```python
all_memories = requests.get(
    f"{API}/memories",
    headers=HEADERS,
    params={"user_id": "user-123", "namespace": "my-app", "limit": 20},
).json()

print(f"{all_memories['total']} memories found")
```

### Delete a Memory

```python
requests.delete(f"{API}/memories/mem_abc123", headers=HEADERS)
# 204 No Content
```

---

## cURL

For quick testing or shell scripts. All examples assume `SMARA_API_KEY` is set.

### Store a Memory

```bash
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123",
    "content": "Prefers dark mode and Vim keybindings",
    "tags": ["preferences", "editor"],
    "importance": 0.8,
    "namespace": "my-app"
  }'
```

### Search Memories

```bash
curl -X POST https://api.smara.io/v1/memories/search \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-123",
    "q": "editor preferences",
    "top_n": 5,
    "namespace": "my-app"
  }'
```

### List All Memories

```bash
curl "https://api.smara.io/v1/memories?user_id=user-123&namespace=my-app&limit=20" \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

### Delete a Memory

```bash
curl -X DELETE https://api.smara.io/v1/memories/mem_abc123 \
  -H "Authorization: Bearer $SMARA_API_KEY"
```

---

## MCP Integration

If you use Claude Code, Cursor, or Windsurf, you don't need to write any API calls. The Smara MCP server handles everything automatically.

### One-Command Setup

```bash
npx @smara/mcp-server --init
```

This adds the Smara MCP server to your IDE settings. Or configure manually:

```json
// Claude Code: ~/.claude/settings.json
// Cursor: .cursor/mcp.json
// Windsurf: ~/.windsurf/mcp.json
{
  "mcpServers": {
    "smara": {
      "command": "npx",
      "args": ["-y", "smara-mcp"],
      "env": {
        "SMARA_API_KEY": "smr_xxxxxxxxxxxx",
        "SMARA_USER_ID": "your-name",
        "SMARA_NAMESPACE": "my-project"
      }
    }
  }
}
```

Once connected, your AI assistant will automatically:

- **Store** important facts as you work (preferences, decisions, patterns)
- **Search** past memories before answering, bringing in relevant context
- **Decay** stale memories so only fresh, relevant context surfaces

---

## Teams

Share memories across your team so every member's AI assistant has shared project context.

### Create a Team Memory

```bash
# Team memories use a shared namespace with a team_ prefix
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "team",
    "content": "Our API uses camelCase for JSON fields and kebab-case for URLs",
    "tags": ["conventions", "api"],
    "importance": 0.9,
    "namespace": "team_acme-corp"
  }'
```

### Search Team Context

```bash
# Any team member can query shared memories
curl -X POST https://api.smara.io/v1/memories/search \
  -H "Authorization: Bearer $SMARA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "team",
    "q": "API naming conventions",
    "namespace": "team_acme-corp"
  }'
```

> **Tip:** Combine personal and team namespaces in your MCP config. Set `SMARA_NAMESPACE` to your team namespace, and use a separate personal namespace for individual preferences.

---

## Best Practices

### Organize with Namespaces & Tags

- Use **one namespace per project** to keep memories isolated
- Use `team_` prefix for shared team namespaces
- Add **2-3 tags** per memory for better filtering: `["auth", "security", "oauth"]`

### Set Importance Scores Thoughtfully

| Score | Use For | Example |
|-------|---------|---------|
| 0.9-1.0 | Critical rules | "Never expose API keys in client code" |
| 0.7-0.8 | Preferences & patterns | "Uses TypeScript strict mode" |
| 0.4-0.6 | Context & notes | "Last sprint focused on auth refactor" |
| 0.1-0.3 | Ephemeral facts | "Currently debugging issue #234" |

### Leverage Decay Scoring

Smara uses Ebbinghaus decay curves to rank memories. Frequently accessed memories stay strong; unused ones fade. This means:

- You don't need to manually clean up old memories
- Search results are automatically ranked by relevance *and* freshness
- Access a memory (via search) to "reinforce" it and prevent decay

### Keep Memories Atomic

Store one fact per memory, not paragraphs. This improves search precision:

```
// Bad: one big memory
"Uses React with TypeScript, deploys to Vercel, prefers Tailwind, tests with Vitest"

// Good: separate memories
"Frontend framework: React with TypeScript"
"Deployment platform: Vercel"
"CSS framework: Tailwind CSS"
"Test runner: Vitest"
```

---

## Next Steps

- [Full API Documentation](https://smara.io/docs) -- complete reference for all endpoints, parameters, and response shapes
- [Interactive Playground](https://smara.io/playground) -- test the API live in your browser
- [Pricing](https://smara.io/pricing) -- free tier (100 memories), Developer ($19/mo), Team ($79/mo)
- [Claude Code MCP Tutorial](https://smara.io/blog/claude-code-memory-mcp.html) -- detailed walkthrough of the MCP integration
- [Building AI Agents with Memory](https://smara.io/blog/ai-agents-persistent-memory.html) -- full agent loop with memory patterns
- [GitHub](https://github.com/smara-io/smara) -- open-source MCP server and examples

---

*Free tier, no credit card. Start building AI tools with memory at [smara.io](https://smara.io).*
