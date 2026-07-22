'use client';

import { useState } from 'react';
import { Icon } from '@/components/icon';
import { Alert, Avatar, Badge, EmptyState } from '@/components/ui';
import { formatDate } from '@/lib/format';

type PendingStudent = {
  id: string;
  name: string;
  email: string;
  nickname: string;
  cpfLast4: string;
  requestedAt: string;
  registryMatch: boolean;
  requestedClass: string;
};

export function PendingApprovals({ initialStudents }: { initialStudents: PendingStudent[] }) {
  const [students, setStudents] = useState(initialStudents);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadingIds, setLoadingIds] = useState<string[]>([]);

  async function handleAction(id: string, action: 'approve' | 'reject') {
    setLoadingIds((items) => [...items, id]);
    setError('');
    try {
      const response = await fetch(`/api/admin/students/${id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível analisar o cadastro.');
      const student = students.find((item) => item.id === id);
      setStudents((items) => items.filter((item) => item.id !== id));
      setSelected((items) => items.filter((item) => item !== id));
      setMessage(`${student?.name || 'Cadastro'} foi ${action === 'approve' ? 'aprovado' : 'rejeitado'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha na análise.');
    } finally {
      setLoadingIds((items) => items.filter((item) => item !== id));
    }
  }

  async function approveSelected() {
    for (const id of [...selected]) await handleAction(id, 'approve');
  }

  return (
    <>
      {message ? <div className="mb-4"><Alert tone="success">{message}</Alert></div> : null}
      {error ? <div className="mb-4"><Alert tone="danger">{error}</Alert></div> : null}
      {selected.length ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3"><p className="text-sm font-semibold text-slate-900">{selected.length} cadastro(s) selecionado(s)</p><div className="flex gap-2"><button onClick={approveSelected} className="app-button-primary"><Icon name="check" className="h-4 w-4" /> Aprovar selecionados</button><button onClick={() => setSelected([])} className="app-button-secondary">Limpar</button></div></div> : null}
      <div className="app-table-wrap overflow-x-auto">
        <table className="app-table min-w-[980px]">
          <thead><tr><th className="w-12"><input type="checkbox" checked={students.length > 0 && selected.length === students.length} onChange={(event) => setSelected(event.target.checked ? students.map((item) => item.id) : [])} /></th><th>Solicitante</th><th>CPF</th><th>Turma solicitada</th><th>Base oficial</th><th>Data</th><th>Ações</th></tr></thead>
          <tbody>
            {students.map((student) => <tr key={student.id}><td><input type="checkbox" checked={selected.includes(student.id)} onChange={(event) => setSelected((items) => event.target.checked ? [...new Set([...items, student.id])] : items.filter((id) => id !== student.id))} /></td><td><div className="flex items-center gap-3"><Avatar name={student.name} size="sm" /><div><p className="font-bold text-slate-900">{student.name}</p><p className="mt-1 text-xs text-slate-500">{student.email} · @{student.nickname}</p></div></div></td><td>***.***.***-{student.cpfLast4.slice(-2)}</td><td>{student.requestedClass}</td><td>{student.registryMatch ? <Badge tone="success"><Icon name="check" className="h-3.5 w-3.5" /> Encontrado</Badge> : <Badge tone="warning"><Icon name="alert" className="h-3.5 w-3.5" /> Não encontrado</Badge>}</td><td>{formatDate(student.requestedAt, true)}</td><td><div className="flex gap-2"><button disabled={loadingIds.includes(student.id)} onClick={() => handleAction(student.id, 'approve')} className="app-button-primary"><Icon name={loadingIds.includes(student.id) ? 'refresh' : 'check'} className={`h-4 w-4 ${loadingIds.includes(student.id) ? 'animate-spin' : ''}`} /> Aprovar</button><button disabled={loadingIds.includes(student.id)} onClick={() => handleAction(student.id, 'reject')} className="app-button-danger"><Icon name="x" className="h-4 w-4" /></button></div></td></tr>)}
            {!students.length ? <tr><td colSpan={7}><EmptyState icon="check-circle" title="Nenhum cadastro pendente" description="Todos os cadastros já foram analisados." /></td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
