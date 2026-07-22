import { Icon, type IconName } from '@/components/icon';
import { Alert, Badge, Card } from '@/components/ui';

export type RuntimeSettings = {
  organizationName: string;
  organizationId: string;
  role: 'admin' | 'coordinator' | 'teacher';
  appName: string;
  secureCookies: boolean;
  loginRateLimitMax: number;
  loginRateLimitWindowSeconds: number;
  aiConfigured: boolean;
  aiModel: string;
  aiRateLimitMax: number;
  aiRateLimitWindowSeconds: number;
  aiRequestTimeoutMs: number;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
  usdBrlRate: number;
  maxImportFileMb: number;
};

const roleLabel: Record<RuntimeSettings['role'], string> = {
  admin: 'Administrador',
  coordinator: 'Coordenador',
  teacher: 'Professor'
};

function maskId(value: string): string {
  if (!value) return 'Não definido';
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function secondsLabel(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

function StatusRow({ icon, label, value, detail, tone = 'neutral' }: { icon: IconName; label: string; value: string; detail?: string; tone?: 'neutral' | 'success' | 'warning' }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 py-4 last:border-b-0 last:pb-0 first:pt-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-700"><Icon name={icon} className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          {detail ? <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p> : null}
        </div>
      </div>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

export function SettingsPanel({ settings }: { settings: RuntimeSettings }) {
  return (
    <div className="space-y-6">
      <Alert tone="primary">Esta tela apresenta a configuração real carregada pelo servidor. Segredos e chaves não são exibidos nem editados no navegador.</Alert>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Identidade do ambiente" description="Dados da organização e do acesso atual.">
          <StatusRow icon="graduation" label="Organização" value={settings.organizationName} detail={`ID ${maskId(settings.organizationId)}`} tone="success" />
          <StatusRow icon="layers" label="Aplicação" value={settings.appName} detail="Nome exibido no sistema e nas telas de autenticação." />
          <StatusRow icon="shield" label="Papel ativo" value={roleLabel[settings.role]} detail="As permissões das rotas e ações usam esse vínculo ativo." />
          <StatusRow icon="globe" label="Idioma e fuso" value="pt-BR · UTC−3" detail="Interface em português e horário oficial de Brasília." />
        </Card>

        <Card title="Segurança e acesso" description="Valores aplicados pela API no ambiente atual.">
          <StatusRow icon="lock" label="Cookies de sessão" value={settings.secureCookies ? 'Secure ativo' : 'Modo local'} detail="Cookies HTTP-only, SameSite=Lax e Secure conforme o ambiente." tone={settings.secureCookies ? 'success' : 'warning'} />
          <StatusRow icon="alert-circle" label="Limite de login" value={`${settings.loginRateLimitMax} tentativas`} detail={`Janela de ${secondsLabel(settings.loginRateLimitWindowSeconds)} por identificador protegido.`} />
          <StatusRow icon="database" label="Banco e autenticação" value="Supabase" detail="Acesso pelo backend, schema app, políticas RLS e isolamento por organização." tone="success" />
          <StatusRow icon="id-card" label="Dados pessoais" value="Protegidos" detail="CPF armazenado com hash e apenas os últimos dígitos disponíveis para conferência." tone="success" />
        </Card>

        <Card title="Pontuação" description="Regra determinística usada no envio das tentativas.">
          <StatusRow icon="target" label="Escala final" value="0 a 100" detail="A nota normalizada é compatível com os gráficos, percentuais e faixas pedagógicas." tone="success" />
          <StatusRow icon="circle" label="Questão fácil" value="Peso 1,0" detail="Base de pontuação antes do bônus de velocidade." />
          <StatusRow icon="circle" label="Questão média" value="Peso 1,5" detail="Base de pontuação antes do bônus de velocidade." />
          <StatusRow icon="circle" label="Questão difícil" value="Peso 2,0" detail="Base de pontuação antes do bônus de velocidade." />
          <StatusRow icon="clock" label="Bônus por velocidade" value="Até 20%" detail="Aplicado somente em respostas corretas, de acordo com o tempo esperado." />
        </Card>

        <Card title="IA, importação e custos" description="Parâmetros reais usados pelas rotas administrativas.">
          <StatusRow icon="sparkles" label="Google Gemini" value={settings.aiConfigured ? 'Configurado' : 'Não configurado'} detail={`Modelo ${settings.aiModel}. A chave permanece apenas no servidor.`} tone={settings.aiConfigured ? 'success' : 'warning'} />
          <StatusRow icon="clock" label="Tempo limite da IA" value={`${Math.round(settings.aiRequestTimeoutMs / 1000)} s`} detail={`${settings.aiRateLimitMax} solicitações por janela de ${secondsLabel(settings.aiRateLimitWindowSeconds)}.`} />
          <StatusRow icon="chart" label="Estimativa de custo" value="Dinâmica" detail={`Entrada US$ ${settings.inputCostPerMillionUsd}/1M · saída US$ ${settings.outputCostPerMillionUsd}/1M · câmbio R$ ${settings.usdBrlRate}.`} tone="success" />
          <StatusRow icon="upload" label="Arquivo de importação" value={`Até ${settings.maxImportFileMb} MB`} detail="CSV e XLSX com pré-visualização, validação por linha e classificação entre novo, atualização e inválido." />
        </Card>
      </div>

      <Card title="Alterações de configuração" description="Valores de infraestrutura não devem ser gravados por formulários públicos.">
        <div className="flex items-start gap-3 text-sm leading-6 text-slate-500">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-slate-900" />
          <p>Para mudar limites, modelo de IA ou credenciais, atualize as variáveis do ambiente de deploy e publique uma nova versão. Matérias, cores, turmas, simulados e questões continuam editáveis nas telas próprias, com persistência no banco.</p>
        </div>
      </Card>
    </div>
  );
}
