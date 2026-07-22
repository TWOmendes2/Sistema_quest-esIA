'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icon';
import { Alert, ProgressBar, StatusBadge } from '@/components/ui';
import type { ClassSummary } from '@/lib/domain-types';

type FormState = { id?: string; name: string; code: string; description: string; status: 'active' };
const blank: FormState = { name: '', code: '', description: '', status: 'active' };

export function ClassManager({ initialClasses }: { initialClasses: ClassSummary[] }) {
  const [classes, setClasses] = useState(initialClasses);
  const [form, setForm] = useState<FormState>(blank);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => classes.filter((item) => `${item.name} ${item.code} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase())), [classes, search]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      const response = await fetch(form.id ? `/api/admin/classes/${form.id}` : '/api/admin/classes', { method: form.id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.name, code: form.code || undefined, description: form.description || null, status: form.status }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível salvar a turma.');
      const saved = payload.data;
      setClasses((items) => form.id ? items.map((item) => item.id === form.id ? { ...item, ...saved } : item) : [...items, { ...saved, students: 0, subjects: 0, quizzes: 0, participation: 0, average: 0 }].sort((a,b) => a.name.localeCompare(b.name)));
      setOpen(false); setMessage({ tone: 'success', text: form.id ? 'Turma atualizada.' : 'Turma criada com sucesso.' });
    } catch (error) { setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Erro ao salvar.' }); }
    finally { setSaving(false); }
  }

  async function remove(item: ClassSummary) {
    if (!confirm(`Excluir definitivamente a turma ${item.name}? Matrículas, atribuições e rankings vinculados também serão apagados.`)) return;
    const response = await fetch(`/api/admin/classes/${item.id}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return setMessage({ tone: 'danger', text: payload?.error?.message || 'Falha ao excluir.' });
    setClasses((items) => items.filter((row) => row.id !== item.id));
    setMessage({ tone: 'success', text: 'Turma excluída definitivamente.' });
  }

  function edit(item: ClassSummary) { setForm({ id: item.id, name: item.name, code: item.code, description: item.description || '', status: 'active' }); setOpen(true); setMessage(null); }

  return <div className="space-y-5">
    {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full max-w-md"><Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar turma" /></div><div className="flex gap-2"><a href="/api/admin/exports/classes" className="app-button-secondary"><Icon name="download" className="h-4 w-4" /> Exportar</a><button className="app-button-primary" onClick={() => { setForm(blank); setOpen(true); }}><Icon name="plus" className="h-4 w-4" /> Nova turma</button></div></div>
    {open ? <form onSubmit={save} className="app-card grid gap-4 p-5 lg:grid-cols-[1fr_.5fr_1.3fr_auto] lg:items-end"><div><label className="app-label">Nome</label><input className="app-input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Turma 3º Ano 2026" /></div><div><label className="app-label">Código</label><input className="app-input uppercase" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="T3A26" /></div><div><label className="app-label">Descrição</label><input className="app-input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Turno, unidade ou observações" /></div><div className="flex gap-2"><button type="button" className="app-button-secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="app-button-primary" disabled={saving}><Icon name={saving ? 'refresh' : 'save'} className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> Salvar</button></div></form> : null}
    <div className="app-table-wrap"><table className="app-table"><thead><tr><th>Turma</th><th>Alunos</th><th>Matérias</th><th>Simulados</th><th>Participação</th><th>Média</th><th>Status</th><th className="text-right">Ações</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><Link href={`/admin/turmas/${item.id}`} className="font-semibold text-slate-900 hover:underline">{item.name}</Link><p className="mt-1 text-xs text-slate-400">{item.code} · {item.description || 'Sem descrição'}</p></td><td>{item.students}</td><td>{item.subjects}</td><td>{item.quizzes}</td><td className="min-w-36"><ProgressBar value={item.participation} /></td><td><b className="text-slate-900">{item.average.toFixed(1)}</b></td><td><StatusBadge status={item.status} /></td><td><div className="flex justify-end gap-2"><button className="app-button-secondary px-3 py-2" onClick={() => edit(item)}><Icon name="edit" className="h-4 w-4" /></button><button className="app-button-danger px-3 py-2" onClick={() => remove(item)} title="Excluir turma"><Icon name="trash" className="h-4 w-4" /></button></div></td></tr>)}</tbody></table></div>
    {!filtered.length ? <div className="app-card p-10 text-center text-sm text-slate-500">Nenhuma turma encontrada.</div> : null}
  </div>;
}
