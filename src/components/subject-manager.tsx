'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import { Alert, ProgressBar, StatusBadge } from '@/components/ui';
import type { SubjectSummary } from '@/lib/domain-types';

const DEFAULT_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#059669', '#D97706', '#DC2626', '#DB2777', '#4F46E5'];

type FormState = { id?: string; name: string; code: string; color: string; status: 'active' };
const blank: FormState = { name: '', code: '', color: DEFAULT_COLORS[0], status: 'active' };

export function SubjectManager({ initialSubjects }: { initialSubjects: SubjectSummary[] }) {
  const [subjects, setSubjects] = useState(initialSubjects);
  const [form, setForm] = useState<FormState>(blank);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => subjects.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(search.toLowerCase())), [subjects, search]);

  function startCreate() { setForm(blank); setOpen(true); setMessage(null); }
  function startEdit(subject: SubjectSummary) { setForm({ id: subject.id, name: subject.name, code: subject.code, color: subject.color, status: 'active' }); setOpen(true); setMessage(null); }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const response = await fetch(form.id ? `/api/admin/subjects/${form.id}` : '/api/admin/subjects', { method: form.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.name, code: form.code || undefined, color: form.color, status: form.status }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível salvar a matéria.');
      const saved = payload.data;
      setSubjects((items) => form.id ? items.map((item) => item.id === form.id ? { ...item, ...saved } : item) : [...items, { ...saved, teachers: 0, classes: 0, students: 0, quizzes: 0, questions: 0, average: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setOpen(false); setMessage({ tone: 'success', text: form.id ? 'Matéria atualizada.' : 'Matéria criada e disponível para turmas e simulados.' });
    } catch (error) { setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Erro ao salvar.' }); }
    finally { setSaving(false); }
  }

  async function remove(subject: SubjectSummary) {
    if (!confirm(`Excluir definitivamente a matéria ${subject.name}? Simulados, questões, tentativas e relatórios vinculados também serão apagados.`)) return;
    const response = await fetch(`/api/admin/subjects/${subject.id}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return setMessage({ tone: 'danger', text: payload?.error?.message || 'Não foi possível excluir.' });
    setSubjects((items) => items.filter((item) => item.id !== subject.id));
    setMessage({ tone: 'success', text: 'Matéria excluída definitivamente.' });
  }

  return <div className="space-y-5">
    {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full max-w-md"><Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar matéria ou código" /></div>
      <div className="flex gap-2"><a className="app-button-secondary" href="/api/admin/exports/subjects"><Icon name="download" className="h-4 w-4" /> Exportar</a><button className="app-button-primary" onClick={startCreate}><Icon name="plus" className="h-4 w-4" /> Nova matéria</button></div>
    </div>

    {open ? <form onSubmit={save} className="app-card grid gap-4 p-5 md:grid-cols-[1.4fr_.7fr_.6fr_auto] md:items-end">
      <div><label className="app-label">Nome</label><input className="app-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} placeholder="Ex.: Física" /></div>
      <div><label className="app-label">Código</label><input className="app-input uppercase" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="FIS" /></div>
      <div><label className="app-label">Cor</label><div className="flex items-center gap-2"><input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} className="h-11 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" /><input className="app-input uppercase" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} pattern="#[0-9A-Fa-f]{6}" /></div></div>
      <div className="flex gap-2"><button type="button" className="app-button-secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="app-button-primary" disabled={saving}><Icon name={saving ? 'refresh' : 'save'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> Salvar</button></div>
    </form> : null}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((subject) => <article key={subject.id} className="app-card overflow-hidden"><div className="h-1.5" style={{ background: subject.color }} /><div className="p-5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3">{subject.logoPath ? <span className="flex h-12 w-12 items-center justify-center border border-slate-200 bg-white p-1.5"><Image src={subject.logoPath} alt={`Logo ${subject.name}`} width={44} height={44} className="max-h-full max-w-full object-contain" /></span> : <span className="flex h-11 w-11 items-center justify-center font-black text-slate-900" style={{ background: subject.color }}>{subject.code.slice(0, 3)}</span>}<div><h3 className="font-semibold text-slate-900">{subject.name}</h3><p className="mt-1 text-xs text-slate-500">Código {subject.code}</p>{subject.teacherNames?.length ? <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{subject.teacherNames.join(' · ')}</p> : null}</div></div><StatusBadge status={subject.status} /></div><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric label="Alunos" value={subject.students} /><Metric label="Turmas" value={subject.classes} /><Metric label="Questões" value={subject.questions} /></div><div className="mt-5"><ProgressBar value={subject.average} label={`Média geral ${subject.average.toFixed(1)}`} color={subject.color} /></div><div className="mt-5 flex justify-end gap-2"><button className="app-button-secondary px-3 py-2" onClick={() => startEdit(subject)}><Icon name="edit" className="h-4 w-4" /> Editar</button><button className="app-button-danger px-3 py-2" onClick={() => remove(subject)}><Icon name="trash" className="h-4 w-4" /> Excluir</button></div></div></article>)}</div>
    {!filtered.length ? <div className="app-card p-10 text-center text-sm text-slate-500">Nenhuma matéria encontrada.</div> : null}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-slate-200 bg-white px-2 py-3"><b className="block text-lg text-slate-900">{value}</b><span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span></div>; }
