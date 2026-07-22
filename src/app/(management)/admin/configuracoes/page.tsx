import { PageHeader } from '@/components/ui';
import { SettingsPanel } from '@/components/settings-panel';
import { env } from '@/server/env';
import { requireManagementRoles } from '@/server/data/context';

export default async function SettingsPage() {
  const context = await requireManagementRoles(['admin', 'coordinator']);

  return (
    <>
      <PageHeader eyebrow="Administração" title="Configurações" description="Identidade, segurança, pontuação e integrações carregadas do ambiente real." />
      <SettingsPanel settings={{
        organizationName: context.organizationName,
        organizationId: context.organizationId,
        role: context.role,
        appName: env.appName,
        secureCookies: env.sessionCookieSecure,
        loginRateLimitMax: env.loginRateLimitMax,
        loginRateLimitWindowSeconds: env.loginRateLimitWindowSeconds,
        aiConfigured: Boolean(env.geminiApiKey),
        aiModel: env.geminiModel,
        aiRateLimitMax: env.aiRateLimitMax,
        aiRateLimitWindowSeconds: env.aiRateLimitWindowSeconds,
        aiRequestTimeoutMs: env.aiRequestTimeoutMs,
        inputCostPerMillionUsd: env.geminiInputCostPerMillionUsd,
        outputCostPerMillionUsd: env.geminiOutputCostPerMillionUsd,
        usdBrlRate: env.aiUsdBrlRate,
        maxImportFileMb: env.maxImportFileMb
      }} />
    </>
  );
}
