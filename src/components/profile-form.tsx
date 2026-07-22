'use client';

import { useState } from 'react';
import { Alert, Badge, Card } from '@/components/ui';
import { Icon } from '@/components/icon';

type Profile = { full_name: string; nickname: string; email: string; cpf_last4: string; status: string; classes: string[]; subjects: Array<{ id: string; name: string; color: string }> };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [email, setEmail] = useState(profile.email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/student/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, email }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível salvar.');
      setMessage({ tone: 'success', text: 'Perfil atualizado com sucesso.' });
    } catch (cause) { setMessage({ tone: 'danger', text: cause instanceof Error ? cause.message : 'Falha ao salvar.' }); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]"><div className="space-y-6">{message ? <Alert tone={message.tone}>{message.text}</Alert> : null}<Card title="Dados pessoais" description="Nome e CPF são protegidos. Apelido e e-mail podem ser atualizados."><form onSubmit={save} className="grid gap-5 sm:grid-cols-2"><div><label className="app-label">Nome completo</label><input className="app-input" value={profile.full_name} disabled /></div><div><label className="app-label">Apelido no ranking</label><input className="app-input" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={40} required /></div><div><label className="app-label">E-mail</label><input className="app-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div><label className="app-label">CPF</label><input className="app-input" value={`***.***.***-${profile.cpf_last4.slice(-2)}`} disabled /></div><div><label className="app-label">Status</label><input className="app-input" value={profile.status} disabled /></div><div className="flex items-end justify-end"><button className="app-button-primary" disabled={busy}><Icon name={busy ? 'refresh' : 'save'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Salvar alterações</button></div></form></Card><Card title="Privacidade"><p className="text-sm leading-6 text-slate-500">No ranking público interno, apenas o apelido é exibido. Nome, CPF e e-mail permanecem restritos à equipe autorizada.</p></Card></div><aside className="space-y-6"><Card title="Turmas"><div className="flex flex-wrap gap-2">{profile.classes.map((item) => <Badge key={item}>{item}</Badge>)}{!profile.classes.length ? <span className="text-sm text-slate-500">Sem turma ativa.</span> : null}</div></Card><Card title="Matérias"><div className="space-y-3">{profile.subjects.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3"><i className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /><b className="text-sm text-slate-900">{item.name}</b></div>)}{!profile.subjects.length ? <span className="text-sm text-slate-500">Sem matéria ativa.</span> : null}</div></Card></aside></div>;
}
