'use client';

import Link from 'next/link';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Icon } from '@/components/icon';
import { Alert } from '@/components/ui';

export function ResetPasswordForm({ supabaseUrl, supabaseAnonKey }: { supabaseUrl: string; supabaseAnonKey: string }) {
  const clientRef = useRef<SupabaseClient | null>(null);
  const [ready, setReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;

    async function initializeRecoverySession() {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          detectSessionInUrl: false,
          persistSession: false,
          autoRefreshToken: false
        }
      });
      clientRef.current = supabase;

      try {
        const currentUrl = new URL(window.location.href);
        const code = currentUrl.searchParams.get('code');
        const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const recoveryType = hashParams.get('type');
        const errorDescription = hashParams.get('error_description') || currentUrl.searchParams.get('error_description');

        if (errorDescription) throw new Error(errorDescription);

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (error) throw error;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error('Sessão de recuperação ausente.');
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session || (recoveryType && recoveryType !== 'recovery')) {
          throw new Error('Link inválido ou expirado.');
        }

        window.history.replaceState({}, document.title, '/redefinir-senha');
        if (active) setReady(true);
      } catch (error) {
        console.error('[PASSWORD RESET][RECOVERY SESSION]', error);
        if (active) setInvalidLink(true);
      }
    }

    initializeRecoverySession();
    return () => { active = false; };
  }, [supabaseAnonKey, supabaseUrl]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (password.length < 8) {
      setMessage('A nova senha deve possuir pelo menos 8 caracteres.');
      return;
    }

    if (password !== confirmation) {
      setMessage('A confirmação não corresponde à nova senha.');
      return;
    }

    const supabase = clientRef.current;
    if (!supabase) {
      setMessage('Sessão de recuperação indisponível. Solicite um novo link.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      await supabase.auth.signOut();
      setCompleted(true);
      setMessage('Senha redefinida com sucesso. Você já pode entrar com a nova senha.');

      window.setTimeout(() => {
        window.location.href = '/login?reset=success';
      }, 1800);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Não foi possível redefinir a senha.';
      setMessage(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Criar nova senha"
      description="Defina uma senha nova para recuperar o acesso à plataforma."
      footer={<Link href="/login" className="font-bold text-slate-900 hover:underline">Voltar para o login</Link>}
    >
      {invalidLink ? (
        <div className="space-y-5">
          <Alert tone="danger" title="Link inválido ou expirado">Solicite uma nova redefinição de senha. Links de recuperação possuem validade limitada e só podem ser usados no fluxo correto.</Alert>
          <Link href="/esqueci-senha" className="app-button-primary w-full py-3">
            <Icon name="refresh" className="h-4 w-4" /> Solicitar novo link
          </Link>
        </div>
      ) : !ready ? (
        <div className="flex items-center gap-3 rounded-sm border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <Icon name="refresh" className="h-4 w-4 animate-spin" /> Validando link de recuperação...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="app-label">Nova senha</label>
            <div className="relative">
              <Icon name="lock" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="app-input pl-10 pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                disabled={completed}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-orange-600"
                aria-label="Mostrar ou ocultar senha"
              >
                <Icon name="eye" className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Use pelo menos 8 caracteres e evite reutilizar senhas antigas.</p>
          </div>

          <div>
            <label className="app-label">Confirmar nova senha</label>
            <div className="relative">
              <Icon name="key" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="app-input pl-10"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                disabled={completed}
                required
              />
            </div>
          </div>

          {message ? <Alert tone={completed ? 'success' : 'danger'}>{message}</Alert> : null}

          <button className="app-button-primary w-full py-3" type="submit" disabled={loading || completed}>
            <Icon name={loading ? 'refresh' : 'save'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Salvando...' : completed ? 'Senha atualizada' : 'Salvar nova senha'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
