'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Alert, Badge, Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ClassSummary, SubjectSummary } from '@/lib/domain-types';

export function NewQuizWizard({ subjects, classes }: { subjects: SubjectSummary[]; classes: ClassSummary[] }) {
  const router = useRouter();
  const activeSubjects = subjects.filter((item) => item.status === 'active');
  const activeClasses = classes.filter((item) => item.status === 'active');
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>(activeSubjects[0] ? [activeSubjects[0].id] : []);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [questionCount, setQuestionCount] = useState(20);
  const [duration, setDuration] = useState(70);
  const [releaseAt, setReleaseAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [showExplanation, setShowExplanation] = useState(true);
  const [showRanking, setShowRanking] = useState(true);
  const [allowReview, setAllowReview] = useState(true);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const steps = ['Informações', 'Configuração', 'Público', 'Revisão'];
  const selectedSubjects = useMemo(() => activeSubjects.filter((item) => subjectIds.includes(item.id)), [activeSubjects, subjectIds]);
  const selectedClasses = useMemo(() => activeClasses.filter((item) => classIds.includes(item.id)), [activeClasses, classIds]);
  const estimatedStudents = useMemo(() => selectedClasses.reduce((sum, item) => sum + item.students, 0), [selectedClasses]);

  function toggle(id: string, values: string[], setter: (value: string[]) => void) {
    setter(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
  }
  function next() {
    if (step === 1 && (title.trim().length < 3 || !subjectIds.length)) return setMessage({ tone: 'warning', text: 'Informe um título e selecione ao menos uma matéria.' });
    if (step === 3 && releaseAt && dueAt && new Date(dueAt) <= new Date(releaseAt)) return setMessage({ tone: 'warning', text: 'O prazo final deve ser posterior à liberação.' });
    setMessage(null); setStep((value) => Math.min(4, value + 1));
  }
  async function create() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/quizzes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectIds, classIds, title, description: description || undefined, durationMinutes: duration, plannedQuestionCount: questionCount, releaseAt: releaseAt ? new Date(releaseAt).toISOString() : undefined, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, settings: { maxAttempts, showExplanation, showRanking, allowReview, shuffleQuestions, shuffleOptions } }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível criar o simulado.');
      router.push(`/admin/simulados/${payload.data.id}/questoes`); router.refresh();
    } catch (error) { setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Erro ao criar.' }); }
    finally { setSaving(false); }
  }

  if (!activeSubjects.length) return <Alert tone="warning" title="Cadastre uma matéria primeiro">É necessário ter ao menos uma matéria ativa antes de criar um simulado.</Alert>;
  return <>
    <div className="mb-6 app-card p-5"><div className="flex items-center">{steps.map((label, index) => { const number = index + 1; const active = number === step; const complete = number < step; return <div key={label} className="flex min-w-0 flex-1 items-center last:flex-none"><div className="flex items-center gap-2"><span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold', complete ? 'bg-emerald-500 text-black' : active ? 'bg-white text-black' : 'bg-white text-slate-500')}>{complete ? <Icon name="check" className="h-4 w-4" /> : number}</span><span className={cn('hidden text-xs font-bold sm:block', active ? 'text-slate-900' : 'text-slate-400')}>{label}</span></div>{number < 4 ? <span className={cn('mx-3 h-px min-w-4 flex-1', complete ? 'bg-emerald-500/50' : 'bg-white')} /> : null}</div>; })}</div></div>
    {message ? <div className="mb-5"><Alert tone={message.tone}>{message.text}</Alert></div> : null}

    {step === 1 ? <Card title="Informações básicas" description="Defina o contexto pedagógico do simulado."><div className="grid gap-5"><div><label className="app-label">Título</label><input className="app-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Simulado multidisciplinar — Unidade 5" /></div><div><label className="app-label">Matérias do simulado</label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{activeSubjects.map((subject) => <label key={subject.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3', subjectIds.includes(subject.id) ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white')}><input type="checkbox" checked={subjectIds.includes(subject.id)} onChange={() => toggle(subject.id, subjectIds, setSubjectIds)} className="accent-orange-500" /><i className="h-3 w-3 rounded-full" style={{ background: subject.color }} /><span className="text-sm font-semibold text-slate-900">{subject.name}</span></label>)}</div></div><div><label className="app-label">Descrição</label><textarea className="app-input min-h-28" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Objetivos, conteúdos e orientações para o aluno." /></div></div></Card> : null}

    {step === 2 ? <Card title="Configuração" description="Defina duração, tentativas e comportamento da avaliação."><div className="grid gap-5 sm:grid-cols-3"><NumberField label="Questões planejadas" value={questionCount} min={1} max={300} onChange={setQuestionCount} /><NumberField label="Duração (minutos)" value={duration} min={1} max={600} onChange={setDuration} /><NumberField label="Máximo de tentativas" value={maxAttempts} min={1} max={10} onChange={setMaxAttempts} /></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{[["Mostrar explicação após entrega", showExplanation, setShowExplanation], ["Exibir posição no ranking", showRanking, setShowRanking], ["Permitir revisão antes de finalizar", allowReview, setAllowReview], ["Embaralhar questões", shuffleQuestions, setShuffleQuestions], ["Embaralhar alternativas", shuffleOptions, setShuffleOptions]].map(([label, checked, setter]) => <label key={String(label)} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="h-4 w-4 accent-orange-500" /><span className="text-sm font-semibold text-slate-700">{String(label)}</span></label>)}</div></Card> : null}

    {step === 3 ? <Card title="Público e disponibilidade" description="O acesso será liberado para quem pertencer a uma turma selecionada OU estiver matriculado em uma matéria selecionada."><div><div className="flex items-center justify-between"><label className="app-label">Turmas</label><button type="button" className="text-xs font-semibold text-slate-600" onClick={() => setClassIds(classIds.length === activeClasses.length ? [] : activeClasses.map((item) => item.id))}>{classIds.length === activeClasses.length ? 'Limpar' : 'Selecionar todas'}</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{activeClasses.map((item) => <label key={item.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3', classIds.includes(item.id) ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white')}><input type="checkbox" checked={classIds.includes(item.id)} onChange={() => toggle(item.id, classIds, setClassIds)} className="accent-orange-500" /><span><b className="block text-sm text-slate-900">{item.name}</b><small className="text-slate-500">{item.students} alunos</small></span></label>)}</div></div><div className="mt-5 grid gap-5 sm:grid-cols-2"><div><label className="app-label">Liberação</label><input type="datetime-local" className="app-input" value={releaseAt} onChange={(event) => setReleaseAt(event.target.value)} /></div><div><label className="app-label">Prazo final</label><input type="datetime-local" className="app-input" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div></div><div className="mt-5"><Alert tone="primary" title="Alcance estimado">{classIds.length ? `${estimatedStudents} vínculos de alunos nas turmas selecionadas, com deduplicação aplicada no acesso.` : 'Sem turma selecionada: o acesso será concedido pelas matérias selecionadas.'}</Alert></div></Card> : null}

    {step === 4 ? <Card title="Revisão do rascunho" description="Confira os dados antes de criar."><div className="grid gap-4 sm:grid-cols-2"><Review label="Título" value={title} /><Review label="Matérias" value={selectedSubjects.map((item) => item.name).join(', ')} /><Review label="Turmas" value={selectedClasses.length ? selectedClasses.map((item) => item.name).join(', ') : 'Acesso por matéria'} /><Review label="Planejamento" value={`${questionCount} questões · ${duration} minutos`} /><Review label="Liberação" value={releaseAt ? new Date(releaseAt).toLocaleString('pt-BR') : 'Não definida'} /><Review label="Prazo" value={dueAt ? new Date(dueAt).toLocaleString('pt-BR') : 'Não definido'} /></div><div className="mt-5 flex flex-wrap gap-2">{selectedSubjects.map((item) => <Badge key={item.id}>{item.name}</Badge>)}</div></Card> : null}

    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button type="button" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1} className="app-button-secondary"><Icon name="arrow-left" className="h-4 w-4" /> Voltar</button>{step < 4 ? <button type="button" onClick={next} className="app-button-primary">Continuar <Icon name="arrow-right" className="h-4 w-4" /></button> : <button type="button" onClick={create} disabled={saving} className="app-button-primary"><Icon name={saving ? 'refresh' : 'check'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> {saving ? 'Criando...' : 'Criar e adicionar questões'}</button>}</div>
  </>;
}
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) { return <div><label className="app-label">{label}</label><input className="app-input" type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>; }
function Review({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-2 font-semibold text-slate-900">{value}</p></div>; }
