'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Icon } from '@/components/icon';
import { Alert } from '@/components/ui';
import { formatCpf } from '@/lib/cpf';

export default function FirstAccessPage() {
  const [cpf, setCpf] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setSuccess(false);
    try {
      const response = await fetch('/api/auth/first-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cpf, fullName, email, nickname, password }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result?.error?.message || result?.message || 'Erro ao realizar primeiro acesso.'); return; }
      setSuccess(true);
      const pendingContracts = Number(result?.data?.pendingContracts || 0);
      setMessage(pendingContracts
        ? `Primeiro acesso realizado. Você possui ${pendingContracts} contrato(s) pendente(s) e verá as orientações ao entrar.`
        : 'Primeiro acesso realizado. Sua conta está ativa e pronta para entrar.');
    } catch { setMessage('Erro de conexão com o servidor.'); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell title="Primeiro acesso" description="Valide seu CPF na base oficial e defina as credenciais da sua conta." footer={<span>Já concluiu o cadastro? <Link href="/login" className="font-bold text-blue-700 hover:underline">Voltar ao login</Link></span>}>
      <form onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="app-label">CPF</label><div className="relative"><Icon name="id-card" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10" value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" maxLength={14} required /></div></div>
        <div className="sm:col-span-2"><label className="app-label">Nome completo</label><input className="app-input" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={3} /></div>
        <div className="sm:col-span-2"><label className="app-label">E-mail</label><input className="app-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
        <div><label className="app-label">Apelido para o ranking</label><input className="app-input" value={nickname} onChange={(event) => setNickname(event.target.value)} required minLength={2} maxLength={40} /><p className="mt-1.5 text-xs text-slate-500">Será o único nome exibido publicamente.</p></div>
        <div><label className="app-label">Senha</label><input className="app-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /><p className="mt-1.5 text-xs text-slate-500">Use pelo menos 6 caracteres.</p></div>
        {message ? <div className="sm:col-span-2"><Alert tone={success ? 'success' : 'danger'}>{message}{success ? <Link className="mt-2 block font-bold underline" href="/login">Entrar agora</Link> : null}</Alert></div> : null}
        <div className="sm:col-span-2"><button className="app-button-primary w-full py-3" type="submit" disabled={loading}><Icon name={loading ? 'refresh' : 'check'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Criando acesso...' : 'Criar meu acesso'}</button></div>
      </form>
    </AuthShell>
  );
}
