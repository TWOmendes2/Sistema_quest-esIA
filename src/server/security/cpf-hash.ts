import 'server-only';
import { createHmac } from 'node:crypto';
import { normalizeCpf } from '@/lib/cpf';
import { env } from '@/server/env';

export function hashCpf(rawCpf: string): string {
  const cpf = normalizeCpf(rawCpf);
  return createHmac('sha256', env.cpfPepper).update(cpf).digest('hex');
}
