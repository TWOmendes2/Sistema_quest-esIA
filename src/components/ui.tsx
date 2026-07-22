import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icon';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'purple';

const toneClasses: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700',
  primary: 'border-[#555] bg-white text-slate-900',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  danger: 'border-red-500/30 bg-red-500/10 text-red-700',
  purple: 'border-violet-500/30 bg-violet-500/10 text-violet-700'
};

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold', toneClasses[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toLowerCase();
  const map: Record<string, { label: string; tone: Tone }> = {
    active: { label: 'Ativo', tone: 'success' }, active_student: { label: 'Aluno ativo', tone: 'success' }, imported: { label: 'Importado', tone: 'primary' },
    pending: { label: 'Pendente', tone: 'warning' }, rejected: { label: 'Rejeitado', tone: 'danger' }, blocked: { label: 'Bloqueado', tone: 'danger' },
    delinquent: { label: 'Inadimplente', tone: 'danger' }, inactive: { label: 'Inativo', tone: 'neutral' },
    not_required: { label: 'Sem pendência', tone: 'neutral' }, signed: { label: 'Assinado', tone: 'success' }, waived: { label: 'Dispensado', tone: 'neutral' }, resolved: { label: 'Resolvido', tone: 'success' },
    draft: { label: 'Rascunho', tone: 'neutral' }, review: { label: 'Em revisão', tone: 'warning' }, published: { label: 'Publicado', tone: 'success' },
    archived: { label: 'Arquivado', tone: 'neutral' }, in_progress: { label: 'Em andamento', tone: 'primary' }, submitted: { label: 'Concluído', tone: 'success' },
    reviewed: { label: 'Revisado', tone: 'purple' }, cancelled: { label: 'Cancelado', tone: 'danger' }, queued: { label: 'Na fila', tone: 'neutral' },
    processing: { label: 'Processando', tone: 'primary' }, ready_for_review: { label: 'Pronto para revisão', tone: 'warning' }, approved: { label: 'Aprovado', tone: 'success' },
    failed: { label: 'Falhou', tone: 'danger' }
  };
  const item = map[normalized] ?? { label: status || '—', tone: 'neutral' as Tone };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

export function PageHeader({ eyebrow, title, description, actions, backHref }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; backHref?: string }) {
  return (
    <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {backHref ? <Link href={backHref as Route} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-orange-600"><Icon name="arrow-left" className="h-4 w-4" /> Voltar</Link> : null}
        {eyebrow ? <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className, title, description, action, padding = true }: { children: ReactNode; className?: string; title?: string; description?: string; action?: ReactNode; padding?: boolean }) {
  return (
    <section className={cn('app-card', className)}>
      {(title || description || action) ? <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"><div>{title ? <h2 className="font-semibold text-slate-900">{title}</h2> : null}{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}</div>{action}</div> : null}
      <div className={cn(padding && 'p-5')}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, helper, icon, trend, tone = 'primary' }: { label: string; value: string | number; helper?: string; icon: IconName; trend?: { value: string; positive?: boolean }; tone?: Tone }) {
  const iconTone: Record<Tone, string> = { neutral: 'bg-white text-slate-700', primary: 'bg-white text-black', success: 'bg-emerald-500/10 text-emerald-700', warning: 'bg-amber-500/10 text-amber-700', danger: 'bg-red-500/10 text-red-700', purple: 'bg-violet-500/10 text-violet-700' };
  return <div className="app-card p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-900">{value}</p></div><div className={cn('flex h-10 w-10 items-center justify-center rounded-sm', iconTone[tone])}><Icon name={icon} className="h-5 w-5" /></div></div>{(helper || trend) ? <div className="mt-4 flex items-center gap-2 text-xs">{trend ? <span className={cn('font-bold', trend.positive === false ? 'text-red-700' : 'text-emerald-700')}>{trend.value}</span> : null}{helper ? <span className="text-slate-500">{helper}</span> : null}</div> : null}</div>;
}

export function ProgressBar({ value, max = 100, label, className, color }: { value: number; max?: number; label?: string; className?: string; color?: string }) {
  const percent = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return <div className={className}>{label ? <div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-slate-500">{label}</span><b className="text-slate-800">{Math.round(percent)}%</b></div> : null}<div className="h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: color || '#f1f1f1' }} /></div></div>;
}

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-14 w-14 text-sm' };
  return <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white font-bold text-slate-900', sizes[size], className)}>{initials(name)}</span>;
}

export function EmptyState({ icon = 'file', title, description, action }: { icon?: IconName; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center px-5 py-14 text-center"><span className="flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600"><Icon name={icon} className="h-6 w-6" /></span><h3 className="mt-4 font-semibold text-slate-900">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>{action ? <div className="mt-5">{action}</div> : null}</div>;
}

export function Alert({ tone = 'primary', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const icons: Record<Tone, IconName> = { neutral: 'info', primary: 'info', success: 'check-circle', warning: 'alert', danger: 'alert-circle', purple: 'sparkles' };
  return <div className={cn('flex items-start gap-3 rounded-sm border p-4 text-sm', toneClasses[tone])}><Icon name={icons[tone]} className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0">{title ? <p className="mb-1 font-bold">{title}</p> : null}<div className="leading-6">{children}</div></div></div>;
}

export function Donut({ value, label, size = 116, color = '#f3f3f3' }: { value: number; label?: string; size?: number; color?: string }) {
  const normalized = Math.max(0, Math.min(100, value));
  return <div className="relative inline-flex items-center justify-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(${color} ${normalized * 3.6}deg, #292929 0deg)` }}><div className="absolute rounded-full bg-white" style={{ inset: 9 }} /><div className="relative text-center"><strong className="block text-2xl font-semibold text-slate-900">{Math.round(normalized)}%</strong>{label ? <span className="text-[10px] text-slate-500">{label}</span> : null}</div></div>;
}

export function MiniBarChart({ items, max }: { items: Array<{ label: string; value: number; secondary?: string }>; max?: number }) {
  const maximum = max || Math.max(1, ...items.map((item) => item.value));
  return <div className="flex min-h-[170px] items-end gap-3">{items.map((item) => <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center"><div className="mb-2 text-[10px] font-bold text-slate-600">{item.secondary || item.value}</div><div className="flex h-28 w-full items-end overflow-hidden rounded-lg bg-white"><div className="w-full rounded-lg bg-[#707070] transition-all" style={{ height: `${Math.max(4, (item.value / maximum) * 100)}%` }} /></div><span className="mt-2 max-w-full truncate text-[10px] text-slate-500">{item.label}</span></div>)}</div>;
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - ((value - min) / range) * 30}`).join(' ');
  return <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn('h-12 w-full text-slate-900', className)} aria-label="Gráfico de evolução"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function SegmentedProgress({ values }: { values: Array<{ value: number; className: string; label: string }> }) {
  const total = values.reduce((sum, item) => sum + item.value, 0) || 1;
  return <div><div className="flex h-3 overflow-hidden rounded-full bg-white">{values.map((item) => <span key={item.label} className={item.className} style={{ width: `${(item.value / total) * 100}%` }} />)}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">{values.map((item) => <span key={item.label} className="inline-flex items-center gap-1.5"><i className={cn('h-2.5 w-2.5 rounded-full', item.className)} />{item.label}: <b className="text-slate-800">{item.value}</b></span>)}</div></div>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Navegação estrutural">{items.map((item, index) => <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">{index > 0 ? <Icon name="chevron-right" className="h-3.5 w-3.5 text-slate-400" /> : null}{item.href ? <Link href={item.href as Route} className="hover:text-orange-600">{item.label}</Link> : <span className="text-slate-700">{item.label}</span>}</span>)}</nav>;
}
