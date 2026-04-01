---
title: How Ebbinghaus Forgetting Curves Make AI Agents Smarter
published: false
description: Why AI agent memory needs decay scoring, how to share memory across every AI tool, and how to implement it with 3 API calls
tags: ai, agents, memory, psychology, mcp
---

Every AI agent you've built has the same problem: amnesia.

Your user tells the agent they prefer Python over TypeScript. Three sessions later, it suggests a TypeScript solution. They mention they're allergic to peanuts. Next week, the agent recommends a Thai peanut recipe. The agent isn't dumb — it just has no memory between sessions.

The common fix is to dump everything into a vector store and retrieve by similarity. But this creates a different problem: the agent treats a preference from six months ago the same as something the user said five minutes ago. In human cognition, that's not how memory works. And it shouldn't be how agent memory works either.

## What Hermann Ebbinghaus figured out in 1885

Hermann Ebbinghaus was a German psychologist who spent years memorizing nonsense syllables (things like "DAX," "BUP," "ZOL") and testing how quickly he forgot them. His results, published in *Memory: A Contribution to Experimental Psychology*, produced one of the most replicated findings in all of psychology: the forgetting curve.

The core insight: memory retention decays exponentially over time. You don't gradually forget things in a linear way — you lose most of the information quickly, then the remainder fades slowly. But here's the critical part: **every time you recall something, the decay rate slows down.** Memories you access frequently become durable. Memories you never revisit fade to nothing.

This maps perfectly to how AI agents should treat user context. A preference the user mentioned once three months ago should carry less weight than something they reinforced yesterday.

## The math

Ebbinghaus's forgetting curve is described by:

```
R = e^(-t / S)
```

Where:
- **R** = retention (0 to 1, where 1 means perfectly remembered)
- **t** = time elapsed since the memory was formed
- **S** = memory strength (higher = slower decay)
- **e** = Euler's number (~2.718)

When S is small, retention drops fast. When S is large (because the memory is important or frequently accessed), it persists.

For example, with S = 2 days:
- After 1 day: R = e^(-1/2) = **0.61** (61% retention)
- After 3 days: R = e^(-3/2) = **0.22** (22% retention)
- After 7 days: R = e^(-7/2) = **0.03** (basically gone)

With S = 10 days (a stronger memory):
- After 1 day: R = e^(-1/10) = **0.90** (90% retention)
- After 7 days: R = e^(-7/10) = **0.50** (still half strength)
- After 30 days: R = e^(-30/10) = **0.05** (fading, but lasted weeks)

This is the mathematical backbone of spaced repetition systems like Anki. The same principle applies to AI memory.

## Applying Ebbinghaus to agent memory

At [Smara](https://smara.io), we apply this curve to every stored memory. When you save a fact about a user, it gets an importance score between 0 and 1. The decay function runs at query time:

```
decay_score = e^(-days_since_created / (importance × 10))
```

A memory with importance 1.0 has a 10-day effective half-life. A memory with importance 0.1 decays in about a day. This means trivia fades while critical preferences persist — exactly like human memory.

The final retrieval score blends semantic relevance with temporal decay:

```
score = similarity × 0.7 + decay_score × 0.3
```

This means a highly relevant but old memory can be outranked by a moderately relevant but fresh one. The 70/30 split keeps semantic search dominant while letting recency break ties — which is usually what you want.

Every time a memory is retrieved, its access count increments. Frequently accessed memories stay strong, just like Ebbinghaus predicted. Memories nobody asks about quietly fade.

## Three API calls to give your agent memory

Here's how it works in practice. Store a memory:

```bash
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_abc",
    "fact": "Prefers Python over TypeScript for backend work",
    "importance": 0.8
  }'
```

```json
{
  "action": "created",
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Search memories with decay-aware ranking:

```bash
curl "https://api.smara.io/v1/memories/search?\
user_id=user_abc&q=what+language+for+backend&limit=5" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "results": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "fact": "Prefers Python over TypeScript for backend work",
      "importance": 0.8,
      "decay_score": 0.9704,
      "similarity": 0.8832,
      "score": 0.9094,
      "created_at": "2026-03-28T14:30:00.000Z"
    }
  ]
}
```

Notice the response gives you all three components: raw `similarity`, `decay_score`, and the blended `score`. You can see exactly why a memory was ranked where it was.

Get pre-formatted context to inject straight into your LLM prompt:

```bash
curl "https://api.smara.io/v1/users/user_abc/context?\
q=what+should+I+know+about+this+user&top_n=5" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "context": "[1] (importance: 0.8, decay: 0.9704) Prefers Python over TypeScript for backend work\n[2] (importance: 0.6, decay: 0.8521) Works at a fintech startup, team of 5",
  "memories": [...]
}
```

Drop the `context` string into your system prompt and your agent knows who it's talking to — with memories ranked by both relevance and freshness.

## One memory for all your AI tools

Here's the problem nobody's talking about: memory is siloed.

Tell Claude Code you prefer Python. Switch to Cursor — it has no idea. Open Codex — starts from scratch. Every AI tool you use has its own isolated memory, and none of them talk to each other.

Smara fixes this by being platform-agnostic. Every memory is tagged with its source — which tool stored it — but all memories live in one pool. A preference stored via Claude Code is instantly available in Cursor, Codex, or any tool connected to your Smara account.

```json
{
  "fact": "Prefers Python over TypeScript for backend work",
  "source": "claude-code",
  "namespace": "default",
  "decay_score": 0.97
}
```

For MCP-compatible tools (Claude Code, Cursor, Windsurf), Smara's MCP server handles everything automatically — loading context at conversation start and storing new facts silently. No manual tool calls. Install once, and your AI tools remember across sessions and across platforms.

```json
{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "your-key" }
  }
}
```

For OpenAI-compatible tools (Codex, ChatGPT, custom GPTs), Smara provides function definitions and a proxy endpoint. Same memories, different protocol.

The result: switch between AI tools freely without losing context. Your memory follows you.

## How this compares to alternatives

**RAG / vanilla vector search.** Most teams start here: embed everything, retrieve by cosine similarity. This works until your store has thousands of entries and a two-year-old preference outranks last week's update because the phrasing happened to match better. No decay means no sense of time.

**Graph memory (Mem0, etc).** Knowledge graphs capture relationships between entities, which is powerful for certain use cases. But the setup cost is high — you need entity extraction, relationship mapping, and graph traversal logic. For most agent memory needs (remembering user preferences, past decisions, context), it's over-engineered.

**Simple key-value stores (Redis, DynamoDB).** Fast and straightforward, but you lose semantic search entirely. You can only retrieve by exact key, which means your agent needs to know exactly what it's looking for. No fuzzy matching, no "what do I know about this user's tech preferences."

**Smara's approach:** Semantic vector search (pgvector + Voyage AI embeddings) combined with Ebbinghaus decay scoring. You get fuzzy semantic matching that respects the passage of time. Three REST endpoints instead of an SDK to learn. The decay math runs at query time, so you never need batch jobs to update scores.

## The result

With decay-aware memory, agents develop something that feels like actual familiarity. Recent interactions carry more weight. Repeated topics build stronger memories. Old, unreinforced details fade naturally instead of cluttering the context window.

It's a small mathematical change — blending an exponential decay term into your retrieval score — but it makes agent conversations feel fundamentally different. The agent remembers what matters and quietly forgets what doesn't.

[Smara](https://smara.io) has a free tier with 10,000 memories, no credit card required. If you're building an AI agent that talks to users more than once, give it a memory that actually works like one.
