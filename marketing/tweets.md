# Smara Tweet Queue

Post one per day from @SmaraMemo. Copy-paste ready.
Updated 2026-03-31 with universal memory direction.

## Day 1 (Mar 30) — ClavHub launch ✅ POSTED
```
We just published smara-memory on ClavHub.

Every other memory skill needs you to run Qdrant, FastAPI, or git-notes locally.

Smara is just an API key. No docker. No servers. No setup.

clawhub install smara-memory

https://smara.io
```

## Day 2 (Mar 31) — Problem statement ✅ POSTED
```
AI agents ask users the same questions every session.

"What's your name?"
"What language do you prefer?"
"What project are you working on?"

That's not intelligence. That's amnesia.

We built Smara to fix it. One POST, the agent remembers forever.

https://smara.io
```

## Day 3 (Apr 1) — The universal memory problem
```
Tell Claude Code you prefer dark mode.
Switch to Cursor — it has no idea.
Open Codex — starts from scratch.

Your memory is siloed in every AI tool you use.

We're building Smara to fix this: one memory layer, shared across every AI tool.

https://smara.io
```

## Day 4 (Apr 2) — Zero-config memory
```
What if your AI tools just... remembered?

No manual "save this." No config files. No tool calls.

Smara's MCP server auto-loads your context at conversation start and silently stores new facts as you work.

Install once. Memory is automatic.

https://smara.io
```

## Day 5 (Apr 3) — Cross-platform demo
```
Stored in Claude Code: "Sri prefers TypeScript, building a memory API"
Source: claude-code

Next session in Cursor — same memories, instantly available.
Source: cursor

One API key. Every tool sees the same context.

That's Smara.
```

## Day 6 (Apr 4) — Ebbinghaus explainer
```
Why we use Ebbinghaus decay curves in Smara:

Your coffee order from yesterday = highly relevant.
A bug you fixed 6 months ago = probably not.

Memories should fade like human memory does. Recent + frequently accessed = stronger signal.

Most memory APIs treat all facts equally. That's wrong.
```

## Day 7 (Apr 5) — Simplicity
```
Smara's entire API is 3 calls:

POST /v1/memories — store a fact
GET /v1/memories/search — find by meaning
GET /v1/users/:id/context — full user context

No SDK. No graph setup. No config files.

curl + an API key. That's it.
```

## Day 8 (Apr 6) — Contradiction detection
```
"The user switched from VS Code to Neovim"

What should an AI memory system do?

Store both facts (now contradictory)?
Or auto-detect the contradiction, soft-delete the old one, keep the new one?

Smara does this automatically. Cosine similarity > 0.94 = contradiction detected.
```

## Day 9 (Apr 7) — Source tagging
```
Every memory in Smara knows where it came from.

source: "claude-code"
source: "cursor"
source: "codex"
source: "api"

Cross-platform context with full provenance. You can filter by source or see everything — your choice.

Your memory. Every tool.
```

## Day 10 (Apr 8) — Build in public
```
Smara week 1 numbers:

- API: live
- MCP server: v2 with auto-memory
- Waitlist: [X] signups
- Pricing: $0 / $19 / $99
- Source tagging: shipped
- Cross-platform memory: shipped

One memory for all your AI tools. Building in public.

https://smara.io
```

## Day 11 (Apr 9) — Getting started
```
Add persistent memory to Claude Code in 30 seconds:

{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "your-key" }
  }
}

Paste into MCP config. Restart. Done.

Your AI now remembers across sessions. Free tier: 10,000 memories.

https://smara.io
```

## Day 12 (Apr 10) — Technical deep dive
```
Under the hood:

- 1024-dim Voyage AI embeddings
- Ebbinghaus decay: R = e^(-t/S)
- Retrieval: similarity × 0.7 + decay × 0.3
- Dedup: cosine ≥ 0.985 = skip
- Contradiction: 0.94-0.985 = replace old fact
- Source tagging per memory

Simple math. Human-like recall. Cross-platform.

https://api.smara.io/docs
```

## Day 13 (Apr 11) — Cost angle
```
Embedding a memory costs ~$0.00001.

Asking a user the same question twice costs trust.

Having 5 different AI tools each ask the same question? That's insanity.

One memory. Every tool. $0 to start.

https://smara.io
```

## Day 14 (Apr 12) — The vision
```
The future of AI isn't better models.

It's better memory.

Models will get cheaper and faster. But without memory, every conversation starts from zero.

Smara: one memory for all your AI tools. The context layer the industry is missing.

https://smara.io
```
