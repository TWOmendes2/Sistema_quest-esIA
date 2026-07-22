'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui';
import { Icon } from '@/components/icon';
export default function TemporaryPasswordPage() {
  const router = useRouter(); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); if (password !== confirm) return setMessage('As senhas não coincidem.'); setBusy(true); setMessage(''); const response = await fetch('/api/auth/change-temporary-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }); const payload = await response.json().catch(() => null); if (!response.ok) { setMessage(payload?.error?.message || 'Não foi possível alterar a senha.'); setBusy(false); return; } router.replace('/dashboard'); router.refresh(); }
  return <AuthShell title="Crie sua senha pessoal" description="Você entrou com uma senha temporária fornecida pela recepção. Para continuar, defina uma senha pessoal."><form onSubmit={submit} className="space-y-5"><Alert tone="warning">A senha temporária será invalidada imediatamente após esta alteração.</Alert><div><label className="app-label">Nova senha</label><input className="app-input" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div><div><label className="app-label">Confirmar nova senha</label><input className="app-input" type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>{message ? <Alert tone="danger">{message}</Alert> : null}<button className="app-button-primary w-full" disabled={busy}><Icon name={busy ? 'refresh' : 'lock'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Alterando...' : 'Salvar senha pessoal'}</button></form></AuthShell>;
}
