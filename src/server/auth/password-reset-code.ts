import 'server-only';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashRecoveryEmail(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

export function generateRecoveryCode(): string {
  return String(randomInt(100000, 1_000_000));
}

export function hashRecoveryCode(authUid: string, email: string, code: string): string {
  return createHmac('sha256', env.passwordResetSecret)
    .update(`${authUid}:${normalizeEmail(email)}:${code}`)
    .digest('hex');
}

export function recoveryCodeMatches(expectedHash: string, authUid: string, email: string, code: string): boolean {
  const actual = Buffer.from(hashRecoveryCode(authUid, email, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function sendPasswordResetCode(email: string, code: string): Promise<void> {
  if (!env.resendApiKey) {
    throw new Error('RESEND_API_KEY não configurada no ambiente do servidor.');
  }

  const minutes = Math.max(5, Math.min(30, env.passwordResetCodeMinutes));
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: env.passwordEmailFrom,
      to: [normalizeEmail(email)],
      subject: `Código para redefinir sua senha — ${env.appName}`,
      html: `
        <div style="background:#0b0b0b;padding:32px;font-family:Arial,sans-serif;color:#fff">
          <div style="max-width:560px;margin:0 auto;background:#151515;border:1px solid #303030;border-radius:14px;padding:30px">
            <p style="margin:0 0 8px;color:#aaa;font-size:13px;text-transform:uppercase;letter-spacing:.08em">Nexo Avalia</p>
            <h1 style="margin:0 0 18px;font-size:24px">Redefinição de senha</h1>
            <p style="color:#c8c8c8;line-height:1.6">Use o código abaixo para criar uma nova senha. Ele expira em ${minutes} minutos.</p>
            <div style="margin:24px 0;background:#fff;color:#000;border-radius:10px;padding:18px;text-align:center;font-size:34px;font-weight:800;letter-spacing:10px">${code}</div>
            <p style="color:#888;font-size:13px;line-height:1.6">Não informe este código a terceiros. Caso você não tenha solicitado a alteração, ignore esta mensagem.</p>
          </div>
        </div>
      `,
      text: `${env.appName}\n\nSeu código para redefinir a senha é: ${code}\n\nEle expira em ${minutes} minutos.`
    })
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(`O serviço de e-mail recusou o envio (${response.status}): ${payload.slice(0, 300)}`);
  }
}
