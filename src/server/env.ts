import 'server-only';

function normalizeEnvironmentValue(value: string | undefined): string {
  const normalized = (value ?? '').trim();

  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return normalized.slice(1, -1).trim();
    }
  }

  return normalized;
}

function required(name: string): string {
  const value = normalizeEnvironmentValue(process.env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback = ''): string {
  return normalizeEnvironmentValue(process.env[name]) || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  appName: optional('NEXT_PUBLIC_APP_NAME', 'Nexo Avalia'),
  publicAppUrl: optional('NEXT_PUBLIC_APP_URL', optional('APP_URL')),
  defaultOrganizationId: optional('NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  cpfPepper: required('CPF_PEPPER'),
  sessionCookieSecure: optional('SESSION_COOKIE_SECURE', 'true') === 'true',
  loginRateLimitMax: optionalNumber('LOGIN_RATE_LIMIT_MAX', 5),
  loginRateLimitWindowSeconds: optionalNumber('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900),
  aiRateLimitMax: optionalNumber('AI_RATE_LIMIT_MAX', 10),
  aiRateLimitWindowSeconds: optionalNumber('AI_RATE_LIMIT_WINDOW_SECONDS', 3600),
  geminiApiKey: optional('GEMINI_API_KEY'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-3.1-flash-lite'),
  aiRequestTimeoutMs: optionalNumber('AI_REQUEST_TIMEOUT_MS', 55_000),
  geminiInputCostPerMillionUsd: optionalNumber('GEMINI_INPUT_COST_PER_MILLION_USD', 0.25),
  geminiOutputCostPerMillionUsd: optionalNumber('GEMINI_OUTPUT_COST_PER_MILLION_USD', 1.5),
  aiUsdBrlRate: optionalNumber('AI_USD_BRL_RATE', 5.5),
  maxImportFileMb: optionalNumber('MAX_IMPORT_FILE_MB', 5),
  contractSignatureUrl: optional('CONTRACT_SIGNATURE_URL'),
  resendApiKey: optional('RESEND_API_KEY'),
  passwordEmailFrom: optional('PASSWORD_EMAIL_FROM', 'Nexo Avalia <onboarding@resend.dev>'),
  passwordResetSecret: optional('PASSWORD_RESET_SECRET', required('CPF_PEPPER')),
  passwordResetCodeMinutes: optionalNumber('PASSWORD_RESET_CODE_MINUTES', 10)
};
