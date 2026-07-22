'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Icon } from '@/components/icon';
import { Alert } from '@/components/ui';
import { formatCpf } from '@/lib/cpf';

export default function RegisterPage() {
  const [form, setForm] = useState({ cpf: '', fullName: '', email: '', nickname: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'active' | 'pending' | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage(''); setStatus(null);
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível concluir o cadastro.');
      setStatus(payload.data.status);
      setMessage(payload.data.status === 'active' ? 'Cadastro validado na base oficial. Sua conta está ativa.' : 'Cadastro recebido. A coordenação precisa aprovar seu acesso.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro de conexão.'); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell title="Solicitar cadastro" description="Seu CPF será comparado com a base oficial. Registros não encontrados ficam pendentes para análise." footer={<span>Já possui conta? <Link href="/login" className="font-bold text-blue-700 hover:underline">Entrar</Link></span>}>
      <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="app-label">CPF</label><input className="app-input" value={form.cpf} onChange={(event) => setForm({ ...form, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" maxLength={14} required /></div>
        <div className="sm:col-span-2"><label className="app-label">Nome completo</label><input className="app-input" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></div>
        <div className="sm:col-span-2"><label className="app-label">E-mail</label><input className="app-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></div>
        <div><label className="app-label">Apelido</label><input className="app-input" value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} required minLength={2} maxLength={40} /></div>
        <div><label className="app-label">Senha</label><input className="app-input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={6} /></div>
        {message ? <div className="sm:col-span-2"><Alert tone={status === 'active' ? 'success' : status === 'pending' ? 'warning' : 'danger'}>{message}{status === 'active' ? <Link href="/login" className="mt-2 block font-bold underline">Entrar na plataforma</Link> : null}</Alert></div> : null}
        <div className="sm:col-span-2"><button className="app-button-primary w-full py-3" disabled={loading}><Icon name={loading ? 'refresh' : 'arrow-right'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Enviando...' : 'Enviar cadastro'}</button></div>
      </form>
      <p className="mt-5 text-xs leading-5 text-slate-500">Ao enviar, você declara que os dados são verdadeiros. CPF é tratado de forma protegida e não aparece em rankings.</p>
    </AuthShell>
  );
}
