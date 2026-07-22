'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Alert } from '@/components/ui';

export function StartQuizButton({ quizId, label = 'Iniciar simulado' }: { quizId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/attempts/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quizId }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível iniciar o simulado.');
      router.push(`/simulados/${quizId}/realizar?attemptId=${payload.data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao iniciar.');
      setBusy(false);
    }
  }
  return <div>{error ? <div className="mb-3"><Alert tone="danger">{error}</Alert></div> : null}<button onClick={start} disabled={busy} className="app-button-primary w-full sm:w-auto"><Icon name={busy ? 'refresh' : 'play'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Preparando...' : label}</button></div>;
}
