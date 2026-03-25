import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required');
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

export async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: MODEL,
    input: text.trim(),
    dimensions: DIMENSIONS,
  });
  return response.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await client.embeddings.create({
    model: MODEL,
    input: texts.map(t => t.trim()),
    dimensions: DIMENSIONS,
  });
  return response.data.map(d => d.embedding);
}
