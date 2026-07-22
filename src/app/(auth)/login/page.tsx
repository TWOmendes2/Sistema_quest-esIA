'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Icon } from '@/components/icon';
import { Alert } from '@/components/ui';
import { formatCpf } from '@/lib/cpf';

export default function LoginPage() {
  const [mode, setMode] = useState<'student' | 'staff'>('student');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'danger' | 'success'>('danger');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const resetStatus = new URLSearchParams(window.location.search).get('reset');
    if (resetStatus === 'success') {
      setMessageTone('success');
      setMessage('Senha redefinida com sucesso. Entre usando sua nova senha.');
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageTone('danger');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'student' ? { cpf, password } : { email, password })
      });
      const result = await response.json();
      if (!response.ok) {
        const errorMessage = result?.error?.message || result?.message || 'Erro ao entrar.';
        const errorCode = result?.error?.code || result?.code;
        setMessage(errorCode === 'UNAUTHORIZED' && errorMessage.includes('Primeiro acesso') ? 'Esse CPF existe na base, mas precisa realizar o primeiro acesso.' : errorMessage);
        return;
      }
      window.location.href = result?.data?.redirectTo || '/dashboard';
    } catch {
      setMessage('Erro de conexão com o servidor. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Entrar"
      description={mode === 'student' ? 'Use seu CPF e a senha definida no primeiro acesso.' : 'Use o e-mail cadastrado pela administração.'}
      footer={mode === 'student' ? <span>Não possui acesso? <Link href="/register" className="font-bold text-blue-700 hover:underline">Solicitar cadastro</Link></span> : <span>O acesso da equipe é liberado por um administrador.</span>}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
          <button type="button" onClick={() => { setMode('student'); setMessage(''); }} className={`rounded-md px-3 py-2 text-sm font-bold transition ${mode === 'student' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Aluno</button>
          <button type="button" onClick={() => { setMode('staff'); setMessage(''); }} className={`rounded-md px-3 py-2 text-sm font-bold transition ${mode === 'staff' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Professor e equipe</button>
        </div>
        {mode === 'student' ? (
          <div><label className="app-label">CPF</label><div className="relative"><Icon name="id-card" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10" value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} placeholder="000.000.000-00" maxLength={14} autoComplete="username" required /></div></div>
        ) : (
          <div><label className="app-label">E-mail institucional</label><div className="relative"><Icon name="mail" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="professor@instituicao.com" autoComplete="username" required /></div></div>
        )}
        <div><div className="mb-1.5 flex items-center justify-between"><label className="text-sm font-semibold text-slate-700">Senha</label><Link href={`/esqueci-senha?mode=${mode}`} className="text-xs font-bold text-white/70 hover:text-white hover:underline">Esqueci minha senha</Link></div><div className="relative"><Icon name="lock" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="app-input pl-10 pr-11" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" required minLength={6} /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700" aria-label="Mostrar ou ocultar senha"><Icon name="eye" className="h-4 w-4" /></button></div></div>
        {message ? <Alert tone={messageTone}>{message}{message.toLowerCase().includes('primeiro acesso') ? <Link className="mt-2 block font-bold underline" href="/first-access">Ir para primeiro acesso</Link> : null}</Alert> : null}
        <label className="flex items-center gap-3 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4 accent-blue-700" /> Manter apenas este dispositivo reconhecido</label>
        <button className="app-button-primary w-full py-3" type="submit" disabled={loading}><Icon name={loading ? 'refresh' : 'arrow-right'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Entrando...' : 'Entrar na plataforma'}</button>
        {mode === 'student' ? <Link className="app-button-secondary w-full" href="/first-access">Realizar primeiro acesso</Link> : null}
      </form>
      <div className="mt-6 flex items-start gap-3 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500"><Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>Sua sessão possui expiração controlada. Nunca compartilhe senha ou código de acesso.</span></div>
    </AuthShell>
  );
}
