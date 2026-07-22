'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';

type Enrollment = {
  id: string;
  class_id: string;
  subject_id: string;
  className: string;
  subjectName: string;
  subjectColor: string;
  status: string;
  contract_status?: string;
  source?: string;
  manual_override?: boolean;
  blocked_reason?: string | null;
};

type Option = { id: string; name: string; color?: string };

type Props = {
  studentId: string;
  enrollments: Enrollment[];
  classes: Option[];
  subjects: Option[];
};

const accessStatuses = [
  { value: 'active', label: 'Ativo' },
  { value: 'delinquent', label: 'Inadimplente' },
  { value: 'blocked', label: 'Bloqueado' },
  { value: 'inactive', label: 'Inativo' }
] as const;

const contractStatuses = [
  { value: 'not_required', label: 'Sem pendência' },
  { value: 'pending', label: 'Contrato pendente' },
  { value: 'signed', label: 'Contrato assinado' },
  { value: 'waived', label: 'Dispensado' }
] as const;

export function StudentAccessManager({ studentId, enrollments, classes, subjects }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [newClassId, setNewClassId] = useState(classes[0]?.id || '');
  const [newSubjectId, setNewSubjectId] = useState(subjects[0]?.id || '');

  async function save(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/students/${studentId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || 'Não foi possível atualizar o acesso.');
      setMessage('Acesso atualizado com sucesso.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao atualizar o acesso.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? <Alert tone={message.includes('sucesso') ? 'success' : 'danger'}>{message}</Alert> : null}

      <div className="space-y-3">
        {enrollments.map((item) => (
          <AccessRow key={item.id} item={item} busy={busy === item.id} onSave={(status, contractStatus, reason) => save({ enrollmentId: item.id, status, contractStatus, reason }, item.id)} />
        ))}
        {!enrollments.length ? <p className="text-sm text-slate-500">Nenhum vínculo cadastrado.</p> : null}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Adicionar acesso manual</p>
        <div className="grid gap-3">
          <select className="app-input" value={newClassId} onChange={(event) => setNewClassId(event.target.value)}>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="app-input" value={newSubjectId} onChange={(event) => setNewSubjectId(event.target.value)}>
            {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button
            type="button"
            className="app-button-secondary w-full"
            disabled={!newClassId || !newSubjectId || busy === 'new'}
            onClick={() => save({ classId: newClassId, subjectId: newSubjectId, status: 'active', contractStatus: 'not_required' }, 'new')}
          >
            <Icon name={busy === 'new' ? 'refresh' : 'plus'} className={`h-4 w-4 ${busy === 'new' ? 'animate-spin' : ''}`} />
            Adicionar acesso
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessRow({ item, busy, onSave }: {
  item: Enrollment;
  busy: boolean;
  onSave: (status: string, contractStatus: string, reason: string | null) => void;
}) {
  const [status, setStatus] = useState(item.status || 'active');
  const [contractStatus, setContractStatus] = useState(item.contract_status || 'not_required');
  const [reason, setReason] = useState(item.blocked_reason || '');
  const changed = status !== item.status || contractStatus !== (item.contract_status || 'not_required') || reason !== (item.blocked_reason || '');

  return (
    <div className="border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: item.subjectColor }} /><b className="text-sm text-slate-900">{item.subjectName}</b></div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{item.className}</p>
          <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={item.status} />{item.contract_status === 'pending' ? <Badge tone="warning">Contrato pendente</Badge> : null}{item.manual_override ? <Badge>Manual</Badge> : <Badge>Importado</Badge>}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        <select className="app-input" value={status} onChange={(event) => setStatus(event.target.value)}>{accessStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select className="app-input" value={contractStatus} onChange={(event) => setContractStatus(event.target.value)}>{contractStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <input className="app-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo do bloqueio ou observação" />
        <button type="button" className="app-button-secondary w-full" disabled={!changed || busy} onClick={() => onSave(status, contractStatus, reason.trim() || null)}>
          <Icon name={busy ? 'refresh' : 'save'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Salvar acesso
        </button>
      </div>
    </div>
  );
}
