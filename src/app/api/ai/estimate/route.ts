import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { estimateAiUsage } from '@/server/ai/estimate';

const schema = z.object({
  text: z.string().max(500_000).default(''),
  questionCount: z.number().int().min(1).max(50),
  difficulty: z.string().max(30).optional()
});

export async function POST(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Parâmetros inválidos.', 400);
  return jsonOk(estimateAiUsage(parsed.data));
}
