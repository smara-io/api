export async function onRequestPost(context) {
  const { request, env } = context;

  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
  };

  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@") || !email.includes(".")) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers,
      });
    }

    // Store in KV: key = email, value = signup metadata
    const existing = await env.WAITLIST.get(email);
    if (existing) {
      return new Response(JSON.stringify({ status: "already_signed_up" }), {
        status: 200,
        headers,
      });
    }

    await env.WAITLIST.put(
      email,
      JSON.stringify({
        email,
        signedUpAt: new Date().toISOString(),
        source: request.headers.get("Referer") || "direct",
      })
    );

    return new Response(JSON.stringify({ status: "subscribed" }), {
      status: 200,
      headers,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
