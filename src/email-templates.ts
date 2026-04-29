/**
 * Email drip sequence templates for Smara signups.
 *
 * Each template is a function that accepts context and returns { subject, html }.
 * Design: white background, minimal, single CTA button per email.
 */

interface TemplateContext {
  name: string;
  email: string;
  apiKey?: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
}

/* ── Shared layout ────────────────────────────────────────────── */

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:32px;">
      <span style="font-size:24px;font-weight:700;color:#6366f1;">Smara</span>
    </div>
    ${content}
  </div>
  <div style="text-align:center;padding:24px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      Smara — One memory for all your AI tools.<br/>
      <a href="https://smara.io/unsubscribe" style="color:#94a3b8;">Unsubscribe</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

function ctaButton(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;margin:8px 0;">${text}</a>`;
}

/* ── Templates ────────────────────────────────────────────────── */

export const DRIP_TEMPLATES: Record<string, (ctx: TemplateContext) => EmailTemplate> = {

  /* Day 0 — Welcome (immediate) */
  welcome: (ctx) => ({
    subject: 'Welcome to Smara — your API key is ready',
    html: layout(`
      <h1 style="color:#1e293b;font-size:22px;margin:0 0 12px;">Welcome, ${ctx.name}!</h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Your Smara account is ready. Here's everything you need to start storing memories for your AI tools.
      </p>
      ${ctx.apiKey ? `
      <div style="background:#1e1b4b;border-radius:8px;padding:20px;margin:24px 0;">
        <p style="color:#a5b4fc;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px;">Your API Key</p>
        <code style="color:#c7d2fe;font-size:14px;word-break:break-all;">${ctx.apiKey}</code>
      </div>
      <p style="color:#ef4444;font-size:13px;">Save this key now — it cannot be recovered.</p>
      ` : ''}
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Add Smara to Claude Code, Cursor, or Windsurf in under a minute:
      </p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0;">
        <pre style="margin:0;font-size:13px;color:#334155;white-space:pre-wrap;">{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "your-key-here" }
  }
}</pre>
      </div>
      <div style="margin:28px 0;">
        ${ctaButton('Read the docs', 'https://api.smara.io/docs')}
      </div>
    `),
  }),

  /* Day 1 — Quick tutorial */
  quick_start: (ctx) => ({
    subject: 'Store your first memory in 30 seconds',
    html: layout(`
      <h1 style="color:#1e293b;font-size:22px;margin:0 0 12px;">Your first memory in 30 seconds</h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Hi ${ctx.name}, here's the fastest way to see Smara in action:
      </p>
      <div style="background:#f1f5f9;border-radius:8px;padding:20px;margin:24px 0;">
        <p style="color:#334155;font-size:13px;font-weight:600;margin:0 0 8px;">1. Store a memory</p>
        <pre style="margin:0 0 16px;font-size:13px;color:#475569;white-space:pre-wrap;">curl -X POST https://api.smara.io/v1/memories \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"user_id": "me", "fact": "I prefer TypeScript over Python"}'</pre>
        <p style="color:#334155;font-size:13px;font-weight:600;margin:0 0 8px;">2. Recall it</p>
        <pre style="margin:0;font-size:13px;color:#475569;white-space:pre-wrap;">curl "https://api.smara.io/v1/memories/recall?user_id=me&q=language+preference" \\
  -H "Authorization: Bearer YOUR_KEY"</pre>
      </div>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        That's it. Your AI tools now remember what you told them.
      </p>
      <div style="margin:28px 0;">
        ${ctaButton('Try it now', 'https://api.smara.io/docs#/memories/post-memories')}
      </div>
    `),
  }),

  /* Day 3 — Use cases */
  use_cases: (ctx) => ({
    subject: '3 ways developers use Smara',
    html: layout(`
      <h1 style="color:#1e293b;font-size:22px;margin:0 0 12px;">3 ways devs use Smara</h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Hey ${ctx.name}, here are the most popular patterns we see:
      </p>

      <div style="border-left:3px solid #6366f1;padding-left:16px;margin:24px 0;">
        <h3 style="color:#1e293b;font-size:16px;margin:0 0 4px;">1. Chat history for AI assistants</h3>
        <p style="color:#64748b;font-size:14px;line-height:1.5;">
          Store user preferences, past decisions, and context so your chatbot remembers across sessions. No more "as I mentioned before" frustration.
        </p>
      </div>

      <div style="border-left:3px solid #8b5cf6;padding-left:16px;margin:24px 0;">
        <h3 style="color:#1e293b;font-size:16px;margin:0 0 4px;">2. Agent memory</h3>
        <p style="color:#64748b;font-size:14px;line-height:1.5;">
          Give your AI agents persistent memory. They learn from each interaction and get smarter over time. Works with LangChain, CrewAI, and custom agents.
        </p>
      </div>

      <div style="border-left:3px solid #a78bfa;padding-left:16px;margin:24px 0;">
        <h3 style="color:#1e293b;font-size:16px;margin:0 0 4px;">3. RAG without the infrastructure</h3>
        <p style="color:#64748b;font-size:14px;line-height:1.5;">
          Skip building vector DBs from scratch. Smara handles embedding, storage, and semantic retrieval. Just POST facts and GET them back with natural language queries.
        </p>
      </div>

      <div style="margin:28px 0;">
        ${ctaButton('Explore the API', 'https://api.smara.io/docs')}
      </div>
    `),
  }),

  /* Day 7 — MCP integration */
  mcp_guide: (ctx) => ({
    subject: 'Connect your AI tools with MCP',
    html: layout(`
      <h1 style="color:#1e293b;font-size:22px;margin:0 0 12px;">One memory, every AI tool</h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Hi ${ctx.name}, did you know Smara works with any MCP-compatible tool? That means Claude Code, Cursor, Windsurf, and more — all sharing the same memory.
      </p>

      <h3 style="color:#1e293b;font-size:16px;margin:24px 0 8px;">How it works</h3>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        The <a href="https://github.com/smara-io/mcp-server" style="color:#6366f1;">@smara/mcp-server</a> exposes your memories as MCP tools. Your AI assistant can:
      </p>
      <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
        <li>Automatically store important facts from conversations</li>
        <li>Recall relevant context before answering questions</li>
        <li>Share memory across Claude Code, Cursor, and other tools</li>
      </ul>

      <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="color:#334155;font-size:13px;font-weight:600;margin:0 0 8px;">Add to your MCP config:</p>
        <pre style="margin:0;font-size:13px;color:#475569;white-space:pre-wrap;">{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "your-key-here" }
  }
}</pre>
      </div>

      <div style="margin:28px 0;">
        ${ctaButton('Set up MCP', 'https://github.com/smara-io/mcp-server#readme')}
      </div>
    `),
  }),

  /* Day 14 — Upgrade CTA */
  upgrade: (ctx) => ({
    subject: 'Upgrade to Developer — unlock graph memory',
    html: layout(`
      <h1 style="color:#1e293b;font-size:22px;margin:0 0 12px;">Ready for more?</h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;">
        Hi ${ctx.name}, you've been using Smara for two weeks. Here's what you unlock on the Developer plan:
      </p>

      <table style="width:100%;border-collapse:collapse;margin:24px 0;">
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;">Memories</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:14px;">100</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#6366f1;font-size:14px;font-weight:600;">10,000</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;">AI Agents</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:14px;">1</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#6366f1;font-size:14px;font-weight:600;">5</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:14px;">Teams</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:14px;">None</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#6366f1;font-size:14px;font-weight:600;">1 team (5 members)</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;color:#64748b;font-size:14px;">Graph memory</td>
          <td style="padding:12px 16px;color:#94a3b8;font-size:14px;">No</td>
          <td style="padding:12px 16px;color:#6366f1;font-size:14px;font-weight:600;">Yes</td>
        </tr>
      </table>

      <p style="color:#475569;font-size:15px;line-height:1.6;">
        All for <strong>$19/month</strong>. Cancel anytime.
      </p>

      <div style="margin:28px 0;">
        ${ctaButton('Upgrade to Developer', 'https://smara.io/#pricing')}
      </div>
    `),
  }),
};

/** Drip schedule: template key -> delay in days from signup */
export const DRIP_SCHEDULE: { templateKey: string; delayDays: number }[] = [
  { templateKey: 'welcome',     delayDays: 0 },
  { templateKey: 'quick_start', delayDays: 1 },
  { templateKey: 'use_cases',   delayDays: 3 },
  { templateKey: 'mcp_guide',   delayDays: 7 },
  { templateKey: 'upgrade',     delayDays: 14 },
];
