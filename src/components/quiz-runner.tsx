'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icon';
import { Alert, Badge, ProgressBar } from '@/components/ui';
import type { QuizSummary, StudentQuizQuestion } from '@/lib/domain-types';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';

export function QuizRunner({ quiz, questions, attemptId }: { quiz: QuizSummary; questions: StudentQuizQuestion[]; attemptId: string }) {
  const router = useRouter();
  const storageKey = `nexo-attempt:${attemptId}`;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [elapsedByQuestion, setElapsedByQuestion] = useState<Record<string, number>>({});
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const hydrated = useRef(false);
  const question = questions[currentIndex];

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setAnswers(parsed.answers || {});
        setFlagged(parsed.flagged || {});
        setElapsedByQuestion(parsed.elapsedByQuestion || {});
        setTotalSeconds(Number(parsed.totalSeconds || 0));
        setCurrentIndex(Math.min(Number(parsed.currentIndex || 0), Math.max(0, questions.length - 1)));
      }
    } catch { window.localStorage.removeItem(storageKey); }
    hydrated.current = true;
  }, [storageKey, questions.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTotalSeconds((value) => value + 1);
      if (question) setElapsedByQuestion((value) => ({ ...value, [question.id]: (value[question.id] || 0) + 1 }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [question]);

  useEffect(() => {
    if (!hydrated.current) return;
    window.localStorage.setItem(storageKey, JSON.stringify({ answers, flagged, elapsedByQuestion, totalSeconds, currentIndex }));
  }, [answers, flagged, elapsedByQuestion, totalSeconds, currentIndex, storageKey]);

  const answeredCount = Object.keys(answers).length;
  const progress = questions.length ? (answeredCount / questions.length) * 100 : 0;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const summary = useMemo(() => ({ answered: answeredCount, unanswered: questions.length - answeredCount, flagged: flaggedCount }), [answeredCount, flaggedCount, questions.length]);

  async function selectAnswer(optionId: string) {
    if (!question) return;
    const elapsedSeconds = elapsedByQuestion[question.id] || 0;
    setAnswers((value) => ({ ...value, [question.id]: optionId }));
    setSaveState('saving'); setError('');
    try {
      const response = await fetch(`/api/attempts/${attemptId}/answer`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, selectedOptionId: optionId, elapsedSeconds })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível salvar a resposta.');
      setSaveState('saved');
    } catch (cause) {
      setSaveState('error');
      setError(cause instanceof Error ? cause.message : 'Falha ao salvar a resposta.');
    }
  }

  async function finish() {
    setSubmitting(true); setError('');
    try {
      const pendingAnswers = Object.entries(answers).map(([questionId, selectedOptionId]) => ({
        questionId,
        selectedOptionId,
        elapsedSeconds: elapsedByQuestion[questionId] || 0
      }));
      if (pendingAnswers.length) {
        const saveResponse = await fetch(`/api/attempts/${attemptId}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answers: pendingAnswers })
        });
        if (!saveResponse.ok) {
          const savePayload = await saveResponse.json().catch(() => null);
          throw new Error(savePayload?.error?.message || 'Uma ou mais respostas não puderam ser salvas.');
        }
      }
      const response = await fetch(`/api/attempts/${attemptId}/submit`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível finalizar o simulado.');
      window.localStorage.removeItem(storageKey);
      router.replace(`/resultados/${attemptId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao finalizar.');
      setSubmitting(false);
      setShowSubmit(false);
    }
  }

  if (!question) return <div className="app-card p-10 text-center text-slate-500">Este simulado não possui questões aprovadas.</div>;

  return <div className="-m-4 min-h-[calc(100vh-72px)] bg-white sm:-m-6 lg:-m-8">
    <header className="sticky top-[72px] z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{quiz.title}</p><p className="mt-0.5 text-xs text-slate-500">{quiz.subject} · {quiz.className}</p></div><div className="hidden w-52 sm:block"><ProgressBar value={progress} label={`${answeredCount} de ${questions.length} respondidas`} /></div><div className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold', totalSeconds > quiz.durationMinutes * 60 ? 'border-red-500/30 bg-red-500/10 text-red-700' : 'border-slate-200 bg-white text-slate-900')}><Icon name="clock" className="h-4 w-4" /> {formatDuration(totalSeconds)}</div><div className="hidden items-center gap-2 text-xs md:flex"><i className={cn('h-2 w-2 rounded-full', saveState === 'saved' ? 'bg-emerald-400' : saveState === 'saving' ? 'bg-amber-400' : 'bg-red-400')} />{saveState === 'saved' ? 'Salvo' : saveState === 'saving' ? 'Salvando' : 'Erro'}</div></div></header>
    <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8">{error ? <div className="lg:col-span-2"><Alert tone="danger">{error}</Alert></div> : null}<main className="app-card overflow-hidden"><div className="border-b border-slate-200 px-5 py-4 sm:px-7"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-500">Questão {currentIndex + 1} de {questions.length}</span><Badge>{question.topic}</Badge></div><button type="button" onClick={() => setFlagged((value) => ({ ...value, [question.id]: !value[question.id] }))} className={cn('app-button-secondary', flagged[question.id] && 'border-amber-500/40 text-amber-700')}><Icon name="alert" className="h-4 w-4" /> {flagged[question.id] ? 'Marcada' : 'Revisar depois'}</button></div></div><div className="px-5 py-7 sm:px-8 sm:py-9"><p className="whitespace-pre-wrap text-base font-medium leading-8 text-slate-900 sm:text-lg">{question.statement}</p><div className="mt-7 space-y-3">{question.options.map((option) => { const selected = answers[question.id] === option.id; return <button type="button" key={option.id} onClick={() => selectAnswer(option.id)} className={cn('flex w-full items-start gap-4 rounded-md border p-4 text-left transition', selected ? 'border-white bg-white text-black ring-1 ring-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#777]')}><span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold', selected ? 'border-black bg-black text-slate-900' : 'border-[#555]')}>{option.label}</span><span className="pt-1 text-sm leading-6 sm:text-base">{option.text}</span></button>; })}</div></div><div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-between sm:px-7"><button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))} className="app-button-secondary"><Icon name="arrow-left" className="h-4 w-4" /> Anterior</button>{currentIndex < questions.length - 1 ? <button onClick={() => setCurrentIndex((value) => Math.min(questions.length - 1, value + 1))} className="app-button-primary">Próxima <Icon name="arrow-right" className="h-4 w-4" /></button> : <button onClick={() => setShowSubmit(true)} className="app-button-primary"><Icon name="check" className="h-4 w-4" /> Finalizar</button>}</div></main>
      <aside className="space-y-5"><section className="app-card p-5"><div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Mapa de questões</h2><span className="text-xs text-slate-500">{Math.round(progress)}%</span></div><div className="mt-4 grid grid-cols-5 gap-2">{questions.map((item, index) => <button key={item.id} onClick={() => setCurrentIndex(index)} className={cn('relative flex aspect-square items-center justify-center rounded-lg border text-xs font-bold', index === currentIndex ? 'border-white bg-white text-black' : answers[item.id] ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700' : 'border-slate-200 bg-white text-slate-500')}>{index + 1}{flagged[item.id] ? <i className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}</button>)}</div><div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs"><Metric value={summary.answered} label="Respondidas" /><Metric value={summary.unanswered} label="Em branco" /><Metric value={summary.flagged} label="Marcadas" /></div></section><section className="app-card p-5"><button onClick={() => setShowSubmit(true)} className="app-button-primary w-full"><Icon name="check" className="h-4 w-4" /> Entregar simulado</button><p className="mt-3 text-center text-xs text-slate-500">Você poderá revisar o resumo antes de enviar.</p></section></aside>
    </div>
    {showSubmit ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black"><Icon name="check-circle" className="h-6 w-6" /></div><h2 className="mt-5 text-xl font-bold text-slate-900">Entregar simulado?</h2><p className="mt-2 text-sm leading-6 text-slate-500">A correção será feita no servidor usando os gabaritos oficiais.</p><div className="mt-5 grid grid-cols-3 gap-3"><Metric value={summary.answered} label="Respondidas" /><Metric value={summary.unanswered} label="Em branco" /><Metric value={summary.flagged} label="Marcadas" /></div>{summary.unanswered ? <div className="mt-4"><Alert tone="warning">Há {summary.unanswered} questão(ões) sem resposta.</Alert></div> : null}<div className="mt-6 flex justify-end gap-3"><button onClick={() => setShowSubmit(false)} disabled={submitting} className="app-button-secondary">Continuar revisando</button><button onClick={finish} disabled={submitting} className="app-button-primary"><Icon name={submitting ? 'refresh' : 'check'} className={`h-4 w-4 ${submitting ? 'animate-spin' : ''}`} /> {submitting ? 'Enviando...' : 'Confirmar entrega'}</button></div></div></div> : null}
  </div>;
}
function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-3"><b className="block text-lg text-slate-900">{value}</b><span className="text-[10px] text-slate-500">{label}</span></div>; }
