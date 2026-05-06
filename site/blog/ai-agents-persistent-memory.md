# Building AI Agents with Persistent Memory: A Complete Guide

*By [Sri Panchavati](https://parallelromb.dev) | April 2026 | 8 min read*

**Target keywords:** AI agent memory, persistent memory for AI agents, build AI agent with memory

---

The biggest limitation of most AI agents isn't intelligence --- it's amnesia. Every conversation starts from scratch. Every interaction loses context. Your agent can write code, analyze data, and reason through complex problems, but it can't remember that the user prefers TypeScript, dislikes verbose output, or is working on a project called "Atlas."

This guide walks through building an AI agent with true persistent memory using Smara's API. We'll go from zero to a working agent that stores, searches, and connects memories across conversations.

## Table of Contents

1. [Why Agents Need Persistent Memory](#why-agents-need-persistent-memory)
2. [Architecture Overview](#architecture-overview)
3. [Setting Up Smara](#setting-up-smara)
4. [Storing Memories](#storing-memories)
5. [Searching and Retrieving Context](#searching-and-retrieving-context)
6. [Agent-Scoped Memory](#agent-scoped-memory)
7. [Graph Memory: Connecting Facts](#graph-memory-connecting-facts)
8. [Namespaces and Organization](#namespaces-and-organization)
9. [Team Memory for Multi-Agent Systems](#team-memory-for-multi-agent-systems)
10. [Putting It All Together](#putting-it-all-together)
11. [Best Practices](#best-practices)

## Why Agents Need Persistent Memory

Consider a customer support agent. A user contacts support three times over a month:

- **Day 1**: Reports a billing issue. Agent resolves it.
- **Day 10**: Asks about upgrading their plan. Agent explains options.
- **Day 25**: Reports the same billing issue again.

Without persistent memory, the agent on Day 25 has no idea this is a recurring problem. With memory, it can say: "I see this billing issue happened before on Day 1. Let me escalate this to investigate the root cause rather than applying another temporary fix."

That's the difference between a chatbot and an agent.

## Architecture Overview

The architecture is straightforward:

```
User <-> Your Agent <-> LLM (Claude, GPT, etc.)
                   |
                   +-> Smara API (memory storage + retrieval)
                         |
                         +-> Postgres + pgvector (persistence)
```

Before each LLM call, your agent queries Smara for relevant memories and injects them into the system prompt. After each conversation, your agent extracts and stores new facts.

## Setting Up Smara

Sign up at [smara.io](https://smara.io) to get an API key, or self-host with Docker:

```bash
# Self-host option
docker run -d \
  -e DATABASE_URL="postgresql://user:pass@host:5432/smara" \
  -e VOYAGE_API_KEY="your-voyage-key" \
  -p 3010:3010 \
  ghcr.io/parallelromb/smara:latest
```

Install the Python SDK:

```bash
pip install smara
```

Initialize the client:

```python
from smara import Smara

client = Smara(
    api_key="smara_your_api_key_here",
    base_url="https://api.smara.io"  # or your self-hosted URL
)
```

## Storing Memories

The fundamental operation is storing a fact about a user:

```python
# Store a simple fact
result = client.store(
    user_id="user-123",
    fact="Prefers Python over JavaScript for backend work",
    importance=0.7
)
print(result)
# {"action": "stored", "id": "mem-abc-123"}
```

### Importance Scoring

The `importance` parameter (0.0 to 1.0) controls how fast a memory decays over time using Ebbinghaus forgetting curves:

```python
# Core identity fact - decays slowly (10-day half-life)
client.store("user-123", "Is a senior backend engineer at Stripe", importance=1.0)

# Active project - moderate decay (7-day half-life)
client.store("user-123", "Currently building a payment reconciliation service", importance=0.7)

# Passing mention - fast decay (2-day half-life)
client.store("user-123", "Had a meeting with the team today", importance=0.2)
```

### Automatic Deduplication and Contradiction Handling

Smara automatically detects duplicates and contradictions:

```python
# First store
client.store("user-123", "Lives in New York")
# {"action": "stored", "id": "mem-1"}

# Duplicate detection (cosine similarity >= 0.985)
client.store("user-123", "Lives in New York City")
# {"action": "duplicate", "id": "mem-1"}  -- not stored again

# Contradiction handling (cosine similarity 0.94-0.985)
client.store("user-123", "Lives in San Francisco")
# {"action": "replaced", "id": "mem-2", "replaced_id": "mem-1"}
# Old memory soft-deleted, new one stored
```

This is critical for long-running agents. Without automatic deduplication, your memory store fills up with redundant facts. Without contradiction handling, your agent retrieves conflicting information.

### Using Sources and Namespaces

Tag memories with their source and organize them into namespaces:

```python
# Store with source tracking
client.store(
    user_id="user-123",
    fact="Wants to migrate from AWS to GCP",
    importance=0.8,
    source="slack-integration",
    namespace="infrastructure"
)

# Different namespace for different concerns
client.store(
    user_id="user-123",
    fact="Prefers dark mode in all tools",
    importance=0.5,
    source="onboarding-survey",
    namespace="preferences"
)
```

## Searching and Retrieving Context

### Semantic Search

Search memories using natural language:

```python
results = client.search(
    user_id="user-123",
    q="cloud infrastructure preferences",
    limit=5,
    namespace="infrastructure"
)

for r in results:
    print(f"[{r.score:.3f}] {r.fact}")
    print(f"  similarity: {r.similarity}, decay: {r.decay_score}")
```

Results are ranked by a blend of semantic similarity (70%) and Ebbinghaus decay (30%). Recent, important, relevant memories surface first.

### The Context Endpoint

For the fastest integration with LLMs, use the context endpoint. It returns pre-formatted text ready for system prompt injection:

```python
import requests

response = requests.get(
    "https://api.smara.io/v1/users/user-123/context",
    headers={"Authorization": "Bearer smara_..."},
    params={"q": "coding preferences", "top_n": 5}
)

data = response.json()
print(data["context"])
# [1] (importance: 0.9, decay: 0.97, source: api) Prefers Python over JavaScript
# [2] (importance: 0.7, decay: 0.85, source: api) Uses VSCode with Vim keybindings
# [3] (importance: 0.6, decay: 0.72, source: api) Follows Google Python style guide
```

Inject this directly into your LLM call:

```python
import anthropic

client_anthropic = anthropic.Anthropic()
memory_context = data["context"]

response = client_anthropic.messages.create(
    model="claude-sonnet-4-20250514",
    system=f"""You are a helpful coding assistant.

Here is what you know about this user from previous conversations:
{memory_context}

Use this context to personalize your responses. Don't mention that you have memory
unless the user asks about it.""",
    messages=[{"role": "user", "content": "Help me set up a new API project"}]
)
```

## Agent-Scoped Memory

When you have multiple agents (support agent, coding assistant, research agent), you want each one to maintain its own memory scope. Smara has first-class agent support:

```python
import requests

BASE = "https://api.smara.io"
HEADERS = {"Authorization": "Bearer smara_..."}

# Create an agent
agent = requests.post(f"{BASE}/v1/agents", headers=HEADERS, json={
    "name": "CodeAssist",
    "description": "A coding assistant that remembers your preferences",
    "owner_id": "developer-sri",
    "model": "claude-sonnet-4-20250514",
    "system_prompt": "You are a coding assistant with persistent memory."
}).json()

agent_id = agent["id"]

# Store a memory scoped to this agent
requests.post(f"{BASE}/v1/agents/{agent_id}/memories", headers=HEADERS, json={
    "user_id": "user-123",
    "fact": "Prefers functional programming patterns",
    "importance": 0.8
})

# Search this agent's memories only
results = requests.get(
    f"{BASE}/v1/agents/{agent_id}/memories",
    headers=HEADERS,
    params={"user_id": "user-123", "q": "programming style"}
).json()
```

Agent-scoped memories use the source field (`agent:{agentId}`) to isolate memories. Your coding assistant's memories won't pollute your support agent's retrieval results.

## Graph Memory: Connecting Facts

Flat memory storage misses relationships between facts. Smara's graph memory lets you create typed, weighted edges between memories:

```python
# Store two related memories
mem1 = client.store("user-123", "Works at Stripe on payment systems")
mem2 = client.store("user-123", "Building a payment reconciliation service")
mem3 = client.store("user-123", "Needs to handle idempotency in payment retries")

# Connect them
requests.post(f"{BASE}/v1/graph/connect", headers=HEADERS, json={
    "from_memory_id": mem1["id"],
    "to_memory_id": mem2["id"],
    "relationship_type": "context_for",
    "weight": 0.9
})

requests.post(f"{BASE}/v1/graph/connect", headers=HEADERS, json={
    "from_memory_id": mem2["id"],
    "to_memory_id": mem3["id"],
    "relationship_type": "requires",
    "weight": 0.8
})

# Traverse the graph from any starting node
graph = requests.get(
    f"{BASE}/v1/graph/traverse/{mem1['id']}",
    headers=HEADERS,
    params={"depth": 3}
).json()

for node in graph["nodes"]:
    print(f"[depth {node['depth']}] {node['fact']}")
    print(f"  relationship: {node['edge']['relationship_type']}")
```

Graph traversal is bidirectional. Starting from "Works at Stripe," you can reach "Needs idempotency" in two hops. This enables reasoning chains: the agent can understand *why* the user needs idempotency (because they're building payment reconciliation at Stripe).

### Relationship Types

You define relationship types as strings. Common patterns:

- `relates_to` --- general association
- `contradicts` --- conflicting information
- `requires` --- dependency relationship
- `context_for` --- provides background for another fact
- `supersedes` --- newer information replacing older
- `part_of` --- hierarchical relationship

## Namespaces and Organization

Namespaces let you partition memories by domain:

```python
# Store in different namespaces
client.store("user-123", "Prefers dark mode", namespace="preferences")
client.store("user-123", "Sprint 42 ends Friday", namespace="work")
client.store("user-123", "Allergic to shellfish", namespace="personal")

# Search within a specific namespace
work_results = client.search("user-123", q="current sprint", namespace="work")
pref_results = client.search("user-123", q="UI preferences", namespace="preferences")
```

Namespaces are isolated. Searching in "work" won't return results from "personal." This prevents context bleed between domains.

## Team Memory for Multi-Agent Systems

When multiple agents or team members need to share knowledge, use team memory:

```python
# Create a team
team = requests.post(f"{BASE}/v1/teams", headers=HEADERS, json={
    "name": "Engineering",
    "slug": "engineering",
    "user_id": "sri"
}).json()

# Add members
requests.post(f"{BASE}/v1/teams/{team['id']}/members", headers=HEADERS, json={
    "user_id": "agent-codeassist",
    "role": "member",
    "added_by": "sri"
})

# Store a team-visible memory
requests.post(f"{BASE}/v1/memories", headers=HEADERS, json={
    "user_id": "sri",
    "fact": "The API migration deadline is May 15",
    "team_id": team["id"],
    "visibility": "team",
    "importance": 0.9
})

# Any team member can search team memories
results = requests.get(f"{BASE}/v1/memories/search", headers=HEADERS, params={
    "user_id": "agent-codeassist",
    "q": "migration deadline",
    "team_id": team["id"],
    "include_team": "true"
}).json()
```

RBAC roles control access:
- **admin**: Full access, can add/remove members
- **member**: Can read and write team memories
- **read_only**: Can read but not write team memories

## Putting It All Together

Here's a complete agent loop with persistent memory:

```python
import anthropic
import requests

SMARA_KEY = "smara_..."
SMARA_BASE = "https://api.smara.io"
HEADERS = {"Authorization": f"Bearer {SMARA_KEY}"}

claude = anthropic.Anthropic()

def get_memory_context(user_id: str, message: str) -> str:
    """Retrieve relevant memories for the current conversation."""
    response = requests.get(
        f"{SMARA_BASE}/v1/users/{user_id}/context",
        headers=HEADERS,
        params={"q": message, "top_n": 10}
    )
    return response.json().get("context", "No previous context.")

def extract_and_store_facts(user_id: str, conversation: str):
    """Use Claude to extract storable facts from the conversation."""
    extraction = claude.messages.create(
        model="claude-haiku-4-20250414",
        system="Extract discrete facts about the user from this conversation. "
               "Return each fact on a new line. Only include facts worth remembering. "
               "Rate importance 0.0-1.0 after each fact, separated by |",
        messages=[{"role": "user", "content": conversation}]
    )

    facts = extraction.content[0].text.strip().split("\n")
    for line in facts:
        if "|" not in line:
            continue
        fact, importance_str = line.rsplit("|", 1)
        try:
            importance = float(importance_str.strip())
        except ValueError:
            importance = 0.5

        requests.post(
            f"{SMARA_BASE}/v1/memories",
            headers=HEADERS,
            json={
                "user_id": user_id,
                "fact": fact.strip(),
                "importance": min(max(importance, 0.0), 1.0),
                "source": "conversation-extraction"
            }
        )

def agent_respond(user_id: str, user_message: str) -> str:
    """Main agent loop: retrieve context, respond, store new facts."""

    # 1. Get relevant memories
    memory_context = get_memory_context(user_id, user_message)

    # 2. Generate response with memory context
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        system=f"""You are a helpful assistant with persistent memory.

Known facts about this user:
{memory_context}

Use this context naturally. Don't mention "my memory" unless asked.""",
        messages=[{"role": "user", "content": user_message}]
    )

    assistant_message = response.content[0].text

    # 3. Extract and store new facts from this exchange
    conversation = f"User: {user_message}\nAssistant: {assistant_message}"
    extract_and_store_facts(user_id, conversation)

    return assistant_message

# Usage
print(agent_respond("alice", "I just started learning Rust. Any tips for a Python dev?"))
# Agent stores: "Is learning Rust", "Has Python background", etc.

# Later conversation...
print(agent_respond("alice", "I'm stuck on lifetimes"))
# Agent retrieves: "Is learning Rust", "Has Python background"
# Responds with Python-to-Rust analogies, building on context
```

## Best Practices

### 1. Use importance scores strategically

Don't default everything to 0.5. Core identity facts (job, location, expertise) should be 0.8-1.0. Temporary states should be 0.1-0.3. This makes decay scoring work properly.

### 2. Extract facts, don't store conversations

Store discrete facts ("Prefers TypeScript"), not conversation logs ("User said they like TypeScript in message #47"). Facts are searchable and composable. Conversation logs are noise.

### 3. Use namespaces to prevent context bleed

A user's medical preferences shouldn't appear when they ask about code. Namespace your memories by domain.

### 4. Let contradiction handling do the work

Don't manually check for outdated facts. Store the new fact and let Smara's similarity-based contradiction detection handle it. If the cosine similarity is 0.94-0.985, the old fact is automatically soft-deleted.

### 5. Use the context endpoint for LLM integration

Don't fetch raw memories and format them yourself. The `/v1/users/:id/context` endpoint returns pre-formatted, decay-ranked context strings ready for system prompts.

### 6. Scope agent memories

If you have multiple agents, use agent-scoped memory (`POST /v1/agents/:id/memories`) to prevent cross-agent contamination. Your support agent's memories shouldn't influence your coding assistant.

### 7. Connect related facts with graph edges

When you detect that two facts are related (same project, same topic, cause-and-effect), create graph edges. This enables richer retrieval through graph traversal.

---

*Start building agents with persistent memory at [smara.io](https://smara.io). Free tier includes 10,000 memories and 1 agent --- enough to prototype and prove the concept.*
