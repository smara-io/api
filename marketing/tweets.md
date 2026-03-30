# Smara Tweet Queue

Post one per day from @SmaraMemo. Copy-paste ready.

## Day 1 (Mar 30) — ClavHub launch
```
We just published smara-memory on ClavHub.

Every other memory skill needs you to run Qdrant, FastAPI, or git-notes locally.

Smara is just an API key. No docker. No servers. No setup.

clawhub install smara-memory

https://smara.io
```

## Day 2 (Mar 31) — Problem statement
```
AI agents ask users the same questions every session.

"What's your name?"
"What language do you prefer?"
"What project are you working on?"

That's not intelligence. That's amnesia.

We built Smara to fix it. One POST, the agent remembers forever.

https://smara.io
```

## Day 3 (Apr 1) — Ebbinghaus explainer
```
Why we use Ebbinghaus decay curves in Smara:

Your coffee order from yesterday = highly relevant.
A bug you fixed 6 months ago = probably not.

Memories should fade like human memory does. Recent + frequently accessed = stronger signal.

Most memory APIs treat all facts equally. That's wrong.
```

## Day 4 (Apr 2) — Simplicity
```
Smara's entire API is 3 calls:

POST /v1/memories — store a fact
GET /v1/memories/search — find by meaning
GET /v1/users/:id/context — full user context

No SDK. No graph setup. No config files.

curl + an API key. That's it.
```

## Day 5 (Apr 3) — Contradiction detection
```
"The user switched from VS Code to Neovim"

What should an AI memory system do?

Store both facts (now contradictory)?
Or auto-detect the contradiction, soft-delete the old one, keep the new one?

Smara does this automatically. Cosine similarity > 0.94 = contradiction detected.
```

## Day 6 (Apr 4) — Getting started
```
Building an AI agent? Here's a free memory layer:

1. Get an API key at smara.io
2. POST facts after each conversation
3. GET context before each response

10,000 memories free. No credit card.

Your agent just got long-term memory in 10 minutes.
```

## Day 7 (Apr 5) — Technical deep dive
```
We store memories as 1024-dim vectors (Voyage AI) and rank by:

similarity x 0.7 + decay_score x 0.3

decay_score uses the Ebbinghaus forgetting curve:
R = e^(-t/S)

Where t = time since last access, S = memory strength.

Simple math. Human-like recall.

https://api.smara.io/docs
```

## Day 8 (Apr 6) — Comparison
```
Memory solutions for AI agents:

RAG: dump everything, retrieve by similarity
Graph: model relationships, complex setup
Smara: store facts, decay naturally, surface what matters

Sometimes the simplest approach wins.
```

## Day 9 (Apr 7) — Cost angle
```
Embedding a memory costs ~$0.00001.

Asking a user the same question twice costs trust.

That's the math behind Smara.
```

## Day 10 (Apr 8) — Build in public
```
Smara week 1 numbers:

- API: live
- Waitlist: [X] signups
- ClavHub: published
- Pricing: $0 / $19 / $99

Building memory infrastructure for AI agents in public. Follow along.
```
