# How Ebbinghaus Decay Curves Make AI Memory Actually Useful

*By [Sri Panchavati](https://parallelromb.dev) | April 2026 | 5 min read*

**Target keywords:** AI memory decay, Ebbinghaus forgetting curve AI, memory scoring AI agents

---

Most AI memory systems treat every stored fact the same way. A user preference from last week and a mention from six months ago get equal weight in retrieval. This doesn't match how useful memory actually works --- and it's why your AI agent's context window fills up with stale, irrelevant facts.

The fix comes from a 140-year-old psychology experiment.

## The Ebbinghaus Forgetting Curve

In 1885, Hermann Ebbinghaus published his research on memory retention. His key finding: **memory retention decays exponentially over time**, following a predictable curve. The stronger the initial encoding (how important the memory is), the slower it decays.

The formula is elegantly simple:

```
retention = e^(-t / S)
```

Where `t` is time elapsed and `S` is the memory's stability (how strongly it was encoded). A strongly encoded memory fades slowly. A weakly encoded one fades fast.

This is how human memory works. You remember yesterday's important conversation clearly. You vaguely remember a passing comment from last month. You've completely forgotten what you ate for lunch three Tuesdays ago. Your brain doesn't treat all memories equally --- it prioritizes by importance and recency.

AI memory systems should work the same way.

## Why Flat Retrieval Fails

Here's a concrete example. Say your AI assistant has stored 500 memories about a user named Alice over six months. Alice mentions she's moving from New York to San Francisco. She asks: "What's a good neighborhood for me?"

With flat vector retrieval, the system searches for "good neighborhood" and returns results ranked purely by semantic similarity. It might return:

1. "Alice lived in the Upper East Side" (6 months old)
2. "Alice is looking at apartments in the Mission District" (yesterday)
3. "Alice's friend recommended Noe Valley" (3 days ago)
4. "Alice liked the neighborhood feel of Brooklyn Heights" (4 months old)

Results 1 and 4 are about New York. They're semantically similar to the query but completely irrelevant now. A flat retrieval system has no way to know that.

With decay-ranked retrieval, the same search produces:

1. "Alice is looking at apartments in the Mission District" (yesterday, decay: 0.97)
2. "Alice's friend recommended Noe Valley" (3 days ago, decay: 0.91)
3. "Alice is moving from New York to San Francisco" (1 week ago, decay: 0.82)
4. "Alice liked the neighborhood feel of Brooklyn Heights" (4 months old, decay: 0.08)

The old New York memories are still there, but they've decayed. The system naturally prioritizes current, relevant context.

## How Smara Implements Ebbinghaus Decay

Smara applies the forgetting curve at retrieval time. Every memory has two key attributes:

- **importance** (0.0 to 1.0): Set when storing. High importance = slower decay.
- **decay_score**: Calculated live using the Ebbinghaus formula.

The decay function:

```typescript
function ebbinghaus(createdAt: Date, importance: number): number {
  const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const halfLife = Math.max(importance, 0.1) * 10;  // days
  return Math.exp(-days / halfLife);
}
```

A memory with `importance: 1.0` has a 10-day half-life. After 10 days, its decay score drops to ~0.37. After 20 days, ~0.14. After 30 days, ~0.05.

A memory with `importance: 0.3` has a 3-day half-life. After 3 days, ~0.37. After a week, ~0.10. It fades much faster.

The final retrieval score blends vector similarity with decay:

```typescript
function blendScore(similarity: number, decayScore: number): number {
  return similarity * 0.7 + decayScore * 0.3;
}
```

**70% semantic relevance, 30% temporal freshness.** This ratio means that a highly relevant old memory can still beat a vaguely relevant new one --- but all else being equal, recent memories win.

## Before and After: API Examples

### Without decay (typical memory API)

```bash
curl "https://api.example.com/memories/search?user_id=alice&q=food+preferences"
```

```json
{
  "results": [
    { "fact": "Alice is vegetarian", "similarity": 0.92 },
    { "fact": "Alice loves sushi", "similarity": 0.89 },
    { "fact": "Alice is trying a vegan diet", "similarity": 0.87 },
    { "fact": "Alice's favorite restaurant is Nobu", "similarity": 0.84 }
  ]
}
```

Problem: "Alice is vegetarian" and "Alice loves sushi" contradict each other. "Alice is trying a vegan diet" supersedes both. But flat retrieval has no way to tell which is current.

### With Smara's decay scoring

```bash
curl "https://api.smara.io/v1/memories/search?user_id=alice&q=food+preferences"
```

```json
{
  "results": [
    {
      "fact": "Alice is trying a vegan diet",
      "similarity": 0.87,
      "decay_score": 0.95,
      "score": 0.894,
      "created_at": "2026-04-25T..."
    },
    {
      "fact": "Alice is vegetarian",
      "similarity": 0.92,
      "decay_score": 0.12,
      "score": 0.680,
      "created_at": "2025-11-03T..."
    },
    {
      "fact": "Alice loves sushi",
      "similarity": 0.89,
      "decay_score": 0.03,
      "score": 0.632,
      "created_at": "2025-08-19T..."
    }
  ]
}
```

The most recent fact ("trying a vegan diet") surfaces first despite having lower raw similarity. Old contradictory facts are still accessible but ranked lower. The agent gets the right context.

## Automatic Contradiction Handling

Smara goes further than just decay scoring. When you store a new memory, it checks for near-duplicates and contradictions using cosine similarity bands:

- **Cosine >= 0.985**: True duplicate. Skip storage entirely.
- **Cosine 0.94-0.985**: Contradiction detected. Store the new memory, soft-delete the old one.
- **Cosine < 0.94**: New fact. Store alongside existing memories.

So when Alice says "I'm going vegan," Smara automatically detects that this contradicts "I'm vegetarian" and soft-deletes the old memory. No manual cleanup needed.

```bash
# This automatically handles the old "vegetarian" memory
curl -X POST https://api.smara.io/v1/memories \
  -H "Authorization: Bearer smara_..." \
  -d '{
    "user_id": "alice",
    "fact": "Alice is trying a vegan diet",
    "importance": 0.8
  }'

# Response shows what happened
{
  "action": "replaced",
  "id": "new-memory-id",
  "replaced_id": "old-vegetarian-memory-id"
}
```

## Setting Importance Scores

The importance parameter controls how fast a memory decays. Some guidelines:

| Importance | Half-life | Use for |
|-----------|-----------|---------|
| 1.0 | 10 days | Core identity facts, strong preferences |
| 0.7 | 7 days | Current projects, active goals |
| 0.5 | 5 days | General preferences, casual mentions |
| 0.3 | 3 days | Temporary states, passing interests |
| 0.1 | 1 day | Ephemeral context, one-off mentions |

You can also let your AI agent set importance dynamically based on conversation context. A fact mentioned repeatedly or with strong emotional language might warrant `importance: 0.9`. A casual aside might be `importance: 0.2`.

## The Context Endpoint

For the fastest integration, use Smara's context endpoint. It returns decay-ranked memories pre-formatted for LLM system prompts:

```bash
curl "https://api.smara.io/v1/users/alice/context?q=weekend+plans&top_n=5"
```

```json
{
  "context": "[1] (importance: 0.8, decay: 0.95, source: api) Alice is planning a hike this Saturday\n[2] (importance: 0.6, decay: 0.72, source: api) Alice prefers morning activities\n[3] (importance: 0.5, decay: 0.41, source: api) Alice enjoys trail running",
  "memories": [...]
}
```

Drop that `context` string directly into your system prompt. The LLM gets ranked, relevant context with zero post-processing.

## Conclusion

Flat memory retrieval was a reasonable first approach, but it breaks down as memories accumulate. Ebbinghaus decay curves solve this by adding the dimension that vector search misses: **time**. Important recent facts surface. Stale facts fade. Contradictions resolve themselves.

This isn't a theoretical improvement. It's the difference between an AI assistant that confidently tells Alice about great restaurants in New York (where she used to live) and one that recommends spots in San Francisco (where she lives now).

Smara implements this as a core primitive, not a plugin or post-processing step. Every search, every context retrieval, every memory ranking uses decay-blended scoring by default.

---

*Try Smara free at [smara.io](https://smara.io) --- see decay scoring in action with your first 100 memories.*
