// Ebbinghaus forgetting curve applied to memory retrieval scoring.
//
// decay_score = exp(-days_since_created / (importance × 10))
//
// High importance (1.0) → 10-day half-life-ish decay
// Low importance (0.1)  → 1-day half-life-ish decay
//
// Final retrieval score blends vector similarity with decay:
//   score = similarity × 0.7 + decay_score × 0.3

export function ebbinghaus(createdAt: Date, importance: number): number {
  const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const halfLife = Math.max(importance, 0.1) * 10;
  return Math.exp(-days / halfLife);
}

export function blendScore(similarity: number, decayScore: number): number {
  // When decay is high (fresh memories), similarity should dominate.
  // When decay is low (old memories), even moderate similarity matters more.
  // Adaptive blend: fresh memories get 90% similarity weight, old get 70%.
  const similarityWeight = 0.7 + (decayScore * 0.2); // 0.7–0.9
  const decayWeight = 1 - similarityWeight;           // 0.1–0.3
  return similarity * similarityWeight + decayScore * decayWeight;
}
