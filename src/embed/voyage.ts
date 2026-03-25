// Voyage AI embeddings — Anthropic-backed, recommended alongside Claude.
// Model: voyage-3 → 1024 dimensions, strong retrieval quality.
// Docs: https://docs.voyageai.com/reference/embeddings-api

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3';
export const DIMENSIONS = 1024;

async function request(input: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY environment variable is required');

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, model: MODEL }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { data: { index: number; embedding: number[] }[] };
  return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

export async function embed(text: string): Promise<number[]> {
  const results = await request([text.trim()]);
  return results[0];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return request(texts.map(t => t.trim()));
}
