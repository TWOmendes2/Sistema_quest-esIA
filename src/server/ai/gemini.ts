import 'server-only';
import { z } from 'zod';
import { env } from '@/server/env';
import { generatedQuizSchema, geminiResponseSchema, type GeneratedQuiz } from './question-schema';
import { buildEnemPplSystemInstruction, buildEnemPplUserInstructions } from './enem-ppl-profile';

const geminiApiResponseSchema = z.object({
  error: z.object({ message: z.string().optional() }).passthrough().optional(),
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional()
    }).passthrough().optional()
  }).passthrough()).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().optional(),
    candidatesTokenCount: z.number().optional()
  }).passthrough().optional()
}).passthrough();

export type GeminiGenerationResult = {
  quiz: GeneratedQuiz;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  rawResponse: unknown;
};

export async function generateQuizFromTranscript(input: {
  transcript: string;
  requestedTitle: string;
  questionCount: number;
  language?: string;
  difficulty?: 'Misto' | 'Fácil' | 'Médio' | 'Difícil' | string;
  subjectName?: string;
}): Promise<GeminiGenerationResult> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY não configurada.');

  const model = env.geminiModel;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const transcript = compactTranscript(input.transcript);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.geminiApiKey
    },
    signal: AbortSignal.timeout(env.aiRequestTimeoutMs),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: buildEnemPplSystemInstruction({ subjectName: input.subjectName })
        }]
      },
      contents: [{
        role: 'user',
        parts: [{
          text: buildEnemPplUserInstructions({
            requestedTitle: input.requestedTitle,
            language: input.language,
            questionCount: input.questionCount,
            difficulty: input.difficulty,
            subjectName: input.subjectName,
            transcript
          })
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: Math.min(32000, Math.max(6000, input.questionCount * 1100)),
        responseMimeType: 'application/json',
        responseSchema: geminiResponseSchema
      }
    })
  });

  const rawResponse: unknown = await response.json().catch(() => null);
  const parsedPayload = geminiApiResponseSchema.safeParse(rawResponse);
  const payload = parsedPayload.success ? parsedPayload.data : null;
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `Gemini API respondeu ${response.status}.`;
    throw new Error(apiMessage);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('A IA não retornou conteúdo utilizável.');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('A IA retornou JSON inválido.');
  }

  const parsed = generatedQuizSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Resposta da IA fora do formato esperado: ${parsed.error.issues.slice(0, 3).map((issue) => issue.message).join('; ')}`);
  }

  if (parsed.data.questions.length !== input.questionCount) {
    throw new Error(`A IA retornou ${parsed.data.questions.length} questões, mas foram solicitadas ${input.questionCount}.`);
  }

  const inputTokens = Number(payload?.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(payload?.usageMetadata?.candidatesTokenCount || 0);
  const estimatedCostUsd = roundCost(
    (inputTokens / 1_000_000) * env.geminiInputCostPerMillionUsd +
    (outputTokens / 1_000_000) * env.geminiOutputCostPerMillionUsd
  );

  return { quiz: parsed.data, inputTokens, outputTokens, estimatedCostUsd, rawResponse };
}

function compactTranscript(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
