# Add Memory to Claude Code in 30 Seconds with MCP

*By [Sri Panchavati](https://parallelromb.dev) | April 2026 | 3 min read*

**Target keywords:** Claude Code memory, MCP memory server, Claude Code MCP

---

Claude Code is powerful, but it forgets everything between sessions. Your coding preferences, project context, architectural decisions --- gone every time you start a new conversation. The Smara MCP server fixes this. Install it once, and Claude Code remembers.

## What You Get

After setup, Claude Code will:
- Remember your coding preferences (languages, frameworks, style)
- Recall project-specific context across sessions
- Store and retrieve facts about your codebase automatically
- Surface relevant memories based on what you're currently working on

All of this happens through the Model Context Protocol (MCP), so it works natively with Claude Code's tool system.

## Setup (30 seconds)

### Step 1: Get a Smara API Key

Sign up at [smara.io](https://smara.io) (free tier: 100 memories, no credit card).

### Step 2: Add to Claude Code Settings

Open your Claude Code configuration:

```bash
# Open the MCP settings file
code ~/.claude/settings.json
```

Add the Smara MCP server:

```json
{
  "mcpServers": {
    "smara": {
      "command": "npx",
      "args": ["-y", "smara-mcp"],
      "env": {
        "SMARA_API_KEY": "smara_your_key_here",
        "SMARA_USER_ID": "your-name"
      }
    }
  }
}
```

### Step 3: Restart Claude Code

Close and reopen Claude Code. That's it.

## How It Works

The MCP server exposes three tools to Claude Code:

### `smara_store` --- Save a memory

```
Tool: smara_store
Input: { "fact": "Sri prefers TypeScript with strict mode", "importance": 0.8 }
```

Claude Code calls this automatically when it learns something worth remembering about you or your project.

### `smara_search` --- Find relevant memories

```
Tool: smara_search
Input: { "q": "TypeScript preferences" }
```

Before responding to your questions, Claude Code searches for relevant context from past sessions.

### `smara_context` --- Get formatted context

```
Tool: smara_context
Input: { "q": "current project setup", "top_n": 5 }
```

Returns a pre-formatted block of your most relevant memories, ranked by importance and recency using Ebbinghaus decay curves.

## See It in Action

**Session 1** --- you tell Claude Code about your project:

```
You: This project uses Fastify with TypeScript, Postgres with pgvector,
     and we deploy to Railway. Our API prefix is /v1/.

Claude Code: Got it! I'll remember your stack details.
[Internally calls smara_store for each fact]
```

**Session 2** --- days later, different conversation:

```
You: Add a new endpoint for user notifications.

Claude Code: [Searches Smara for project context]
I'll create a Fastify route at /v1/notifications following your
existing patterns. Here's the implementation using your Postgres
connection pool...
```

Claude Code retrieved your stack preferences, API conventions, and deployment target without you repeating anything.

## Using Namespaces

Organize memories by project:

```json
{
  "mcpServers": {
    "smara": {
      "command": "npx",
      "args": ["-y", "smara-mcp"],
      "env": {
        "SMARA_API_KEY": "smara_your_key_here",
        "SMARA_USER_ID": "sri",
        "SMARA_NAMESPACE": "my-api-project"
      }
    }
  }
}
```

Switch namespaces per project so memories don't bleed between codebases.

## Why Not Just Use CLAUDE.md?

`CLAUDE.md` files are great for project-level context that you want to version control. But they have limitations:

| | CLAUDE.md | Smara MCP |
|---|---|---|
| **Scope** | Per-project | Cross-project + per-project |
| **Updates** | Manual edits | Automatic from conversations |
| **Search** | Full file loaded every time | Semantic search, only relevant facts |
| **Decay** | No --- everything stays forever | Yes --- stale facts fade naturally |
| **Personalization** | Project only | You + project |

The best setup is both: `CLAUDE.md` for static project docs, Smara MCP for dynamic personal and project memory.

## Pricing

The free tier gives you 100 memories --- enough for personal coding workflows. If you're using Claude Code professionally and accumulate more context, the Developer plan ($19/mo) gives you 10,000 memories and 5 agents.

| Plan | Memories | Price |
|------|----------|-------|
| Free | 100 | $0/mo |
| Developer | 10,000 | $19/mo |
| Team | 100,000 | $79/mo |

## Troubleshooting

**MCP server not loading?** Check that `npx` is in your PATH and your API key is valid:

```bash
# Test the connection
curl -H "Authorization: Bearer smara_your_key" https://api.smara.io/health
```

**Memories not appearing?** Verify your user_id matches across sessions. Check usage:

```bash
curl -H "Authorization: Bearer smara_your_key" https://api.smara.io/v1/usage
```

**Want to see what's stored?** List your memories:

```bash
curl -H "Authorization: Bearer smara_your_key" \
  "https://api.smara.io/v1/memories?user_id=your-name"
```

---

*Get started at [smara.io](https://smara.io) --- free, no credit card, 30 seconds to persistent memory in Claude Code.*
