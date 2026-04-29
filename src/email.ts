/**
 * Transactional email via Resend (https://resend.com)
 * Sends only if RESEND_API_KEY is set. Fails silently otherwise.
 * Free tier: 100 emails/day, no credit card required.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Smara <noreply@smara.io>';

export async function sendApiKeyEmail(to: string, apiKey: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: 'Your Smara API Key',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h1 style="color: #6366f1; margin-bottom: 8px;">Welcome to Smara</h1>
  <p style="color: #64748b; font-size: 16px; margin-bottom: 32px;">Your API key is ready. Save it somewhere safe — it can't be recovered.</p>

  <div style="background: #1e1b4b; border-radius: 8px; padding: 20px; margin-bottom: 32px;">
    <code style="color: #a5b4fc; font-size: 14px; word-break: break-all;">${apiKey}</code>
  </div>

  <h2 style="color: #334155; font-size: 18px; margin-bottom: 12px;">Quick Start — MCP (Claude Code, Cursor, Windsurf)</h2>
  <p style="color: #64748b; font-size: 14px;">Add this to your MCP config and restart:</p>
  <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 32px;">
    <pre style="margin: 0; font-size: 13px; color: #334155; white-space: pre-wrap;">{
  "smara": {
    "command": "npx",
    "args": ["-y", "@smara/mcp-server"],
    "env": { "SMARA_API_KEY": "${apiKey}" }
  }
}</pre>
  </div>

  <p style="color: #64748b; font-size: 14px;">
    <a href="https://api.smara.io/docs" style="color: #6366f1;">API Docs</a> ·
    <a href="https://smara.io" style="color: #6366f1;">Website</a> ·
    <a href="https://github.com/smara-io/mcp-server" style="color: #6366f1;">GitHub</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0 16px;" />
  <p style="color: #94a3b8; font-size: 12px;">Smara — One memory for all your AI tools.</p>
</div>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[Email] Resend API error ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Email] Failed to send:', err);
    return false;
  }
}
