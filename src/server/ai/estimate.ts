import 'server-only';
import { env } from '@/server/env';

export type AiEstimate = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costBrl: number;
  estimatedSeconds: number;
};

export function estimateAiUsage(input: { text: string; questionCount: number; difficulty?: string }): AiEstimate {
  const compactLength = input.text.replace(/\s+/g, ' ').trim().length;
  const inputTokens = Math.max(1, Math.ceil(compactLength / 3.7) + 420);
  const difficultyFactor = input.difficulty === 'hard' || input.difficulty === 'Difícil' ? 1.18 : input.difficulty === 'easy' || input.difficulty === 'Fácil' ? 0.9 : 1;
  const outputTokens = Math.ceil(input.questionCount * 620 * difficultyFactor + 280);
  const costUsd = round((inputTokens / 1_000_000) * env.geminiInputCostPerMillionUsd + (outputTokens / 1_000_000) * env.geminiOutputCostPerMillionUsd);
  return {
    inputTokens,
    outputTokens,
    costUsd,
    costBrl: round(costUsd * env.aiUsdBrlRate),
    estimatedSeconds: Math.max(8, Math.round(7 + input.questionCount * 2.7 + compactLength / 35_000 * 5))
  };
}

export function usdToBrl(usd: number): number {
  return round(usd * env.aiUsdBrlRate);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
