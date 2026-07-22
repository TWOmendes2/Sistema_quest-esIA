'use client';

import { useState } from 'react';
import { Icon } from '@/components/icon';
import { Alert, Badge, Card } from '@/components/ui';
import { cn } from '@/lib/cn';

type PreviewRow = {
  row: number;
  cpfMasked: string;
  name: string;
  email: string | null;
  activeClasses: string[];
  activeClassCount: number;
  delinquentClassCount: number;
  pendingContractCount: number;
  status: 'new' | 'update' | 'invalid';
  errors: string[];
};

type Summary = {
  total: number;
  imported: number;
  updated: number;
  invalidCpf: number;
  invalid: number;
  activeEnrollments: number;
  delinquentEnrollments: number;
  pendingContracts: number;
};
type PreviewResult = { summary: Summary; rows: PreviewRow[]; truncated: boolean };
type ImportResult = Summary & {
  classesCreated?: number;
  subjectsCreated?: number;
  enrollmentsSynced?: number;
  errors: Array<{ row: number; message: string }>;
  storageWarning?: string | null;
};

const labels: Record<PreviewRow['status'], { text: string; tone: 'success' | 'primary' | 'danger' }> = {
  new: { text: 'Novo', tone: 'success' },
  update: { text: 'Atualizar', tone: 'primary' },
  invalid: { text: 'Inválido', tone: 'danger' }
};

export function ImportStudentsWizard() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  async function request(mode: 'preview' | 'import') {
    if (!file) return;
    setLoading(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);
      const response = await fetch('/api/admin/import-students', { method: 'POST', body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível processar o arquivo.');
      if (mode === 'preview') {
        setPreview(payload.data);
        setStep(2);
      } else {
        setResult(payload.data);
        setStep(4);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao processar o arquivo.');
    } finally {
      setLoading(false);
    }
  }

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setResult(null);
    setMessage('');
    setConfirmed(false);
    if (selected) void requestPreview(selected);
  }

  async function requestPreview(selected: File) {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selected);
      formData.append('mode', 'preview');
      const response = await fetch('/api/admin/import-students', { method: 'POST', body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível validar o arquivo.');
      setPreview(payload.data);
      setStep(2);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha na validação.');
      setStep(1);
    } finally {
      setLoading(false);
    }
  }

  const steps = ['Arquivo', 'Validação', 'Confirmação', 'Resultado'];
  const summary = preview?.summary;

  return (
    <>
      <div className="mb-6 app-card p-5">
        <div className="flex items-center">
          {steps.map((label, index) => {
            const number = index + 1;
            const active = number === step;
            const completed = number < step;
            return (
              <div key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
                <div className="flex items-center gap-2">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold', completed ? 'border-white bg-white text-black' : active ? 'border-white text-slate-900' : 'border-slate-200 text-slate-500')}>{completed ? <Icon name="check" className="h-4 w-4" /> : number}</span>
                  <span className={cn('hidden text-xs font-bold sm:block', active ? 'text-slate-900' : 'text-slate-500')}>{label}</span>
                </div>
                {number < steps.length ? <span className={cn('mx-3 h-px min-w-4 flex-1', completed ? 'bg-white' : 'bg-white')} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {message ? <div className="mb-5"><Alert tone="danger">{message}</Alert></div> : null}

      {step === 1 ? (
        <Card title="Selecione a base de alunos" description="CSV ou XLSX. A pré-visualização abaixo será calculada com o conteúdo real do arquivo.">
          <label className="flex cursor-pointer flex-col items-center rounded-md border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center transition hover:border-[#777] hover:bg-orange-50">
            <span className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-900"><Icon name={loading ? 'refresh' : 'upload'} className={cn('h-7 w-7', loading && 'animate-spin')} /></span>
            <p className="mt-4 font-bold text-slate-900">{loading ? 'Validando arquivo...' : 'Clique para selecionar o arquivo'}</p>
            <p className="mt-2 text-sm text-slate-500">Formato oficial reconhecido: CPF, NOME, EMAIL, TURMAS ATIVAS, TURMAS INADIMPLENTES e CONTRATOS PENDENTES.</p>
            <input type="file" accept=".csv,.xlsx" onChange={selectFile} disabled={loading} className="sr-only" />
          </label>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <a href="/api/admin/import-students/template" className="app-button-secondary"><Icon name="download" className="h-4 w-4" /> Baixar modelo CSV</a>
            <p className="text-xs text-slate-500">O CPF completo não é exibido nem persistido em texto puro.</p>
          </div>
        </Card>
      ) : null}

      {step === 2 && preview ? (
        <div className="space-y-6">
          <Card title="Arquivo validado" action={<button onClick={() => { setFile(null); setPreview(null); setStep(1); }} className="app-button-secondary"><Icon name="refresh" className="h-4 w-4" /> Trocar</button>}>
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-white"><Icon name="file" className="h-5 w-5" /></span><div><p className="font-bold text-slate-900">{file?.name}</p><p className="mt-1 text-xs text-slate-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : ''}</p></div></div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Alunos" value={summary?.total ?? 0} />
            <Metric label="Novos" value={summary?.imported ?? 0} tone="success" />
            <Metric label="Atualizações" value={summary?.updated ?? 0} tone="primary" />
            <Metric label="Inválidos" value={summary?.invalid ?? 0} tone="danger" />
            <Metric label="Vínculos ativos" value={summary?.activeEnrollments ?? 0} tone="success" />
            <Metric label="Turmas inadimplentes" value={summary?.delinquentEnrollments ?? 0} tone="danger" />
            <Metric label="Contratos pendentes" value={summary?.pendingContracts ?? 0} tone="primary" />
          </div>

          <Card title="Pré-visualização real" description={preview.truncated ? 'Mostrando as primeiras 200 linhas.' : 'Todas as linhas encontradas no arquivo.'} padding={false}>
            <div className="overflow-x-auto"><table className="app-table min-w-[1180px]"><thead><tr><th>Linha</th><th>CPF</th><th>Aluno</th><th>Turmas ativas</th><th>Inadimplentes</th><th>Contratos</th><th>Status</th><th>Validação</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td className="font-mono text-xs">{row.cpfMasked}</td><td><p className="font-semibold text-slate-900">{row.name || '—'}</p><p className="mt-1 text-xs text-slate-500">{row.email || 'Sem e-mail'}</p></td><td><p className="font-bold text-slate-900">{row.activeClassCount}</p><p className="mt-1 max-w-[360px] text-xs leading-5 text-slate-500">{row.activeClasses.join(' · ') || 'Nenhuma'}</p></td><td>{row.delinquentClassCount ? <Badge tone="danger">{row.delinquentClassCount}</Badge> : '0'}</td><td>{row.pendingContractCount ? <Badge tone="warning">{row.pendingContractCount}</Badge> : '0'}</td><td><Badge tone={labels[row.status].tone}>{labels[row.status].text}</Badge></td><td className={row.errors.length ? 'text-red-700' : 'text-slate-500'}>{row.errors.join('; ') || 'Sem erros'}</td></tr>)}</tbody></table></div>
          </Card>

          {summary?.invalid ? <Alert tone="warning" title="Existem linhas inválidas">As linhas inválidas não serão importadas. Corrija o arquivo para importar 100% da base ou prossiga apenas com as linhas válidas.</Alert> : <Alert tone="success" title="Arquivo pronto">Todas as linhas passaram pela validação estrutural e de CPF.</Alert>}
          <div className="flex justify-end"><button onClick={() => setStep(3)} className="app-button-primary">Continuar <Icon name="arrow-right" className="h-4 w-4" /></button></div>
        </div>
      ) : null}

      {step === 3 && preview ? (
        <Card title="Confirme a importação" description="A operação sincronizará automaticamente todas as turmas ativas, inadimplências e pendências contratuais do arquivo.">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Novos alunos" value={summary?.imported ?? 0} tone="success" /><Metric label="Alunos atualizados" value={summary?.updated ?? 0} tone="primary" /><Metric label="Acessos ativos" value={summary?.activeEnrollments ?? 0} tone="success" /><Metric label="Inadimplências" value={summary?.delinquentEnrollments ?? 0} tone="danger" /><Metric label="Contratos" value={summary?.pendingContracts ?? 0} tone="primary" /></div>
          <div className="mt-6"><Alert tone="primary" title="Auditoria e segurança">O processamento é feito no servidor, CPFs são armazenados com hash e o resultado é registrado na auditoria.</Alert></div>
          <label className="mt-5 flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 accent-orange-500" /><span className="text-sm leading-6 text-slate-600">Confirmo que possuo autorização para tratar os dados e revisei a pré-visualização.</span></label>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button onClick={() => setStep(2)} className="app-button-secondary">Voltar</button><button onClick={() => request('import')} disabled={!confirmed || loading} className="app-button-primary"><Icon name={loading ? 'refresh' : 'upload'} className={cn('h-4 w-4', loading && 'animate-spin')} /> {loading ? 'Importando...' : 'Confirmar importação'}</button></div>
        </Card>
      ) : null}

      {step === 4 && result ? (
        <Card>
          <div className="flex flex-col items-center py-6 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black"><Icon name="check" className="h-8 w-8" /></span><h2 className="mt-5 text-2xl font-bold text-slate-900">Importação concluída</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Os dados válidos foram gravados na base oficial da Nexo Avalia.</p></div>
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Alunos" value={result.total} /><Metric label="Novos" value={result.imported} tone="success" /><Metric label="Atualizados" value={result.updated} tone="primary" /><Metric label="Vínculos sincronizados" value={result.enrollmentsSynced ?? 0} tone="success" /><Metric label="Turmas criadas" value={result.classesCreated ?? 0} /><Metric label="Erros" value={result.errors.length} tone="danger" /></div>
          {result.storageWarning ? <div className="mx-auto mt-5 max-w-3xl"><Alert tone="warning">{result.storageWarning}</Alert></div> : null}
          {result.errors.length ? <div className="mx-auto mt-5 max-w-3xl"><Alert tone="danger" title="Linhas não importadas">{result.errors.slice(0, 12).map((error) => <div key={`${error.row}-${error.message}`}>Linha {error.row}: {error.message}</div>)}</Alert></div> : null}
          <div className="mt-7 flex justify-center gap-3"><a href="/admin/alunos" className="app-button-primary">Ver alunos</a><button onClick={() => { setStep(1); setFile(null); setPreview(null); setResult(null); setConfirmed(false); }} className="app-button-secondary">Importar outro</button></div>
        </Card>
      ) : null}
    </>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'primary' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-red-700' : tone === 'primary' ? 'text-slate-900' : 'text-slate-800';
  return <div className="rounded-md border border-slate-200 bg-white p-4 text-center"><p className={cn('text-2xl font-black', toneClass)}>{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>;
}
