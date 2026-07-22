'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icon';
import { Alert, Badge, Card, StatusBadge } from '@/components/ui';
import type { AiJobSummary, ClassSummary, QuizSummary, SubjectSummary } from '@/lib/domain-types';
import { formatDate } from '@/lib/format';

type ApiQuestion = {
  id: string;
  statement: string;
  topic: string;
  subtopic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expected_time_seconds: number;
  options: Array<{ label: 'A' | 'B' | 'C' | 'D' | 'E'; text: string }>;
  correct_label: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation_correct: string;
  explanation_wrong: string;
  reviewStatus: string;
};

type Estimate = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costBrl: number;
  estimatedSeconds: number;
};

type GenerateResponse = {
  jobId: string;
  quizId: string;
  targetQuizId: string | null;
  subjectId: string;
  reviewQuestions?: ApiQuestion[];
  questionIds: string[];
  questionCount: number;
  preEstimate: Estimate;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
  actualCostBrl: number;
  durationMs: number;
  duplicatesSkipped: number;
  quiz: {
    title: string;
    description: string;
    questions: Omit<ApiQuestion, 'id' | 'reviewStatus'>[];
  };
};

type FinalizeResponse = {
  approved: number;
  removed: number;
  bankQuizId: string | null;
  bankCopied: number;
  targetCopied: number;
};

type Props = {
  subjects: SubjectSummary[];
  classes: ClassSummary[];
  quizzes: QuizSummary[];
  initialJobs: AiJobSummary[];
};

export function AiGenerator({ subjects, classes, quizzes, initialJobs }: Props) {
  const activeSubjects = useMemo(() => subjects.filter((item) => item.status === 'active'), [subjects]);
  const activeClassCount = useMemo(() => classes.filter((item) => item.status === 'active').length, [classes]);
  const editableQuizzes = useMemo(() => quizzes.filter((item) => ['draft', 'review'].includes(item.status)), [quizzes]);

  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [subjectId, setSubjectId] = useState(activeSubjects[0]?.id || '');
  const [quizId, setQuizId] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'Misto' | 'Fácil' | 'Médio' | 'Difícil'>('Misto');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const generationLock = useRef(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [jobs, setJobs] = useState(initialJobs);

  const selectedSubject = useMemo(
    () => activeSubjects.find((item) => item.id === subjectId),
    [activeSubjects, subjectId]
  );
  const selectedTarget = useMemo(
    () => editableQuizzes.find((item) => item.id === quizId),
    [editableQuizzes, quizId]
  );
  const approvedCount = questions.filter((item) => item.reviewStatus === 'approved').length;
  const rejectedCount = questions.filter((item) => item.reviewStatus === 'rejected').length;
  const reviewCount = questions.length - approvedCount - rejectedCount;

  useEffect(() => {
    if (!rawText.trim() || rawText.trim().length < 20) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoadingEstimate(true);
      try {
        const response = await fetch('/api/ai/estimate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: rawText, questionCount: count, difficulty }),
          signal: controller.signal
        });
        const payload = await response.json();
        if (response.ok) setEstimate(payload.data);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setEstimate(null);
      } finally {
        setLoadingEstimate(false);
      }
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [rawText, count, difficulty]);

  async function generate() {
    if (generationLock.current) return;
    if (result) {
      setMessage({ tone: 'warning', text: 'Conclua ou descarte a revisão atual antes de gerar um novo lote.' });
      return;
    }
    if (rawText.trim().length < 200) {
      setMessage({ tone: 'warning', text: 'Insira pelo menos 200 caracteres de conteúdo-base.' });
      return;
    }
    if (!subjectId) {
      setMessage({ tone: 'warning', text: 'Cadastre ou selecione uma matéria ativa.' });
      return;
    }

    generationLock.current = true;
    setLoading(true);
    setMessage(null);
    setQuestions([]);
    try {
      const response = await fetch('/api/ai/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          quizId: quizId || undefined,
          title: title || `Geração de ${selectedSubject?.name || 'questões'}`,
          transcript: rawText,
          questionCount: count,
          difficulty,
          autoPublish: false,
          promptVersion: 'enem-ppl-nexo-v1',
          language: 'pt-BR'
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Falha ao gerar questões.');

      const data: GenerateResponse = payload.data;
      setResult(data);
      setQuestions(data.reviewQuestions ?? data.quiz.questions.map((item, index) => ({
        ...item,
        id: data.questionIds[index] || `${data.quizId}-${index}`,
        reviewStatus: 'review'
      })));
      setJobs((items) => [{
        id: data.jobId,
        title: title || data.quiz.title,
        subject: selectedSubject?.name || '—',
        status: 'ready_for_review',
        model: null,
        promptVersion: 'enem-ppl-nexo-v1',
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        preEstimatedCostUsd: data.preEstimate.costUsd,
        actualCostUsd: data.actualCostUsd,
        durationMs: data.durationMs,
        questionCount: data.questionCount,
        requestedBy: 'Você',
        createdAt: new Date().toISOString(),
        quizId: data.quizId
      }, ...items]);
      setMessage({
        tone: data.duplicatesSkipped ? 'warning' : 'success',
        text: `${data.questionCount} questões únicas foram criadas em um lote isolado de revisão.${data.duplicatesSkipped ? ` ${data.duplicatesSkipped} duplicada(s) foram ignoradas.` : ''} Aprove ou rejeite cada questão e depois clique em “Concluir revisão”.`
      });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Falha na geração.' });
    } finally {
      generationLock.current = false;
      setLoading(false);
    }
  }

  async function saveQuestion(question: ApiQuestion) {
    setBusyId(question.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          statement: question.statement,
          topic: question.topic,
          subtopic: question.subtopic,
          difficulty: question.difficulty,
          expected_time_seconds: question.expected_time_seconds,
          options: question.options,
          correct_label: question.correct_label,
          explanation_correct: question.explanation_correct,
          explanation_wrong: question.explanation_wrong
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível salvar a questão.');
      setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, reviewStatus: 'review' } : item));
      setEditingId(null);
      setMessage({ tone: 'success', text: 'Alterações salvas. A questão voltou para revisão.' });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Erro ao salvar.' });
    } finally {
      setBusyId(null);
    }
  }

  async function reviewQuestion(question: ApiQuestion, status: 'approved' | 'rejected' | 'review') {
    setBusyId(question.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/questions/${question.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Falha ao revisar.');
      setQuestions((items) => items.map((item) => item.id === question.id ? { ...item, reviewStatus: status } : item));
      setMessage({
        tone: 'success',
        text: status === 'approved'
          ? 'Questão aprovada. Ela será enviada ao banco quando a revisão for concluída.'
          : status === 'rejected'
            ? 'Questão rejeitada. Ela será removida ao concluir a revisão.'
            : 'Questão reaberta para revisão.'
      });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Erro ao revisar.' });
    } finally {
      setBusyId(null);
    }
  }

  async function regenerateQuestion(question: ApiQuestion) {
    const instruction = window.prompt(
      'Como a nova versão deve ser?',
      `Crie uma questão diferente sobre ${question.topic}, mantendo o nível ${question.difficulty}.`
    );
    if (instruction === null) return;
    setBusyId(question.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/questions/${question.id}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Falha ao regenerar.');
      const replacement = payload.data.question;
      setQuestions((items) => items.map((item) => item.id === question.id
        ? { ...item, ...replacement, reviewStatus: 'review' }
        : item));
      setMessage({ tone: 'success', text: `Questão regenerada e salva. Custo real: US$ ${Number(payload.data.actualCostUsd || 0).toFixed(6)}.` });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Falha ao regenerar.' });
    } finally {
      setBusyId(null);
    }
  }

  async function resumeReview(job: AiJobSummary) {
    setLoadingJobId(job.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/ai/jobs/${job.id}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível carregar a revisão.');
      const data: GenerateResponse = payload.data;
      if (!data.quizId || !data.reviewQuestions) throw new Error('Este lote já foi concluído ou não está mais disponível.');
      setResult(data);
      setQuestions(data.reviewQuestions);
      setSubjectId(data.subjectId);
      setQuizId(data.targetQuizId || '');
      setTitle(data.quiz.title);
      setMessage({ tone: 'success', text: 'Lote de revisão retomado. Continue aprovando ou rejeitando as questões.' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Falha ao retomar a revisão.' });
    } finally {
      setLoadingJobId(null);
    }
  }

  async function finalizeReview() {
    if (!result) return;
    const targetName = selectedTarget?.title || (result.targetQuizId
      ? editableQuizzes.find((item) => item.id === result.targetQuizId)?.title
      : null);
    const confirmed = window.confirm(
      `Concluir a revisão?\n\n${approvedCount} aprovada(s) irão para o banco de questões${targetName ? ` e para “${targetName}”` : ''}.\n${reviewCount + rejectedCount} questão(ões) em revisão ou rejeitada(s) serão removidas definitivamente.`
    );
    if (!confirmed) return;

    setFinalizing(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/ai/jobs/${result.jobId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetQuizId: quizId || result.targetQuizId || null })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Não foi possível concluir a revisão.');
      const data: FinalizeResponse = payload.data;
      setJobs((items) => items.map((item) => item.id === result.jobId ? { ...item, status: 'approved' } : item));
      setQuestions([]);
      setResult(null);
      setEditingId(null);
      setMessage({
        tone: 'success',
        text: `Revisão concluída: ${data.bankCopied} questão(ões) foram salvas no banco, ${data.targetCopied} adicionada(s) ao simulado e ${data.removed} rejeitada(s) ou pendente(s) foram removidas.`
      });
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Falha ao concluir a revisão.' });
    } finally {
      setFinalizing(false);
    }
  }

  function updateQuestion(id: string, patch: Partial<ApiQuestion>) {
    setQuestions((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateOption(id: string, index: number, text: string) {
    setQuestions((items) => items.map((item) => item.id === id
      ? { ...item, options: item.options.map((option, optionIndex) => optionIndex === index ? { ...option, text } : option) }
      : item));
  }

  return <div className="space-y-6">
    {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <Card
        title="1. Gerar questões com IA"
        description="A geração cria um lote temporário. Somente questões aprovadas entram no banco ou em um simulado."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="app-label">Título da fonte</label>
            <input className="app-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Aula 12 — Calorimetria" />
          </div>
          <div>
            <label className="app-label">Matéria</label>
            <select className="app-input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={Boolean(result)}>
              {activeSubjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label className="app-label">Simulado de destino (opcional)</label>
            <select className="app-input" value={quizId} onChange={(event) => setQuizId(event.target.value)}>
              <option value="">Salvar somente no banco de questões</option>
              {editableQuizzes.map((item) => <option key={item.id} value={item.id}>
                {item.title}{item.subjectIds.includes(subjectId) ? '' : ' — matéria será adicionada'}
              </option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="app-label">Conteúdo-base</label>
            <textarea
              className="app-input min-h-80 resize-y"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Cole a transcrição, capítulo ou texto que deve fundamentar as questões..."
              disabled={Boolean(result)}
            />
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>Mínimo: 200 caracteres</span>
              <span>{rawText.length.toLocaleString('pt-BR')} caracteres</span>
            </div>
          </div>
        </div>
      </Card>

      <aside className="space-y-6">
        <Card title="Parâmetros da geração">
          <div className="space-y-4">
            <div>
              <label className="app-label">Quantidade</label>
              <input type="number" min={1} max={50} className="app-input" value={count} disabled={Boolean(result)} onChange={(event) => setCount(Math.max(1, Math.min(50, Number(event.target.value))))} />
            </div>
            <div>
              <label className="app-label">Dificuldade</label>
              <select className="app-input" value={difficulty} disabled={Boolean(result)} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>
                <option>Misto</option><option>Fácil</option><option>Médio</option><option>Difícil</option>
              </select>
            </div>
            <div><label className="app-label">Formato</label><input className="app-input" value="5 alternativas (A–E) + justificativas" disabled /></div>
            <div><label className="app-label">Prompt</label><input className="app-input" value="ENEM/PPL — Nexo v1" disabled /></div>
          </div>
          <button onClick={generate} disabled={loading || !subjectId || Boolean(result)} className="app-button-primary mt-6 w-full py-3">
            <Icon name={loading ? 'refresh' : 'sparkles'} className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Gerando lote...' : result ? 'Conclua a revisão atual' : 'Gerar questões'}
          </button>
        </Card>

        <Card title="Estimativa dinâmica" description="Calculada pelo tamanho do texto, quantidade e dificuldade.">
          {loadingEstimate ? <div className="space-y-3"><div className="skeleton h-5" /><div className="skeleton h-5" /><div className="skeleton h-5" /></div>
            : estimate ? <div className="space-y-3 text-sm">
              <Row label="Tokens de entrada" value={estimate.inputTokens.toLocaleString('pt-BR')} />
              <Row label="Tokens de saída" value={estimate.outputTokens.toLocaleString('pt-BR')} />
              <Row label="Custo estimado" value={`R$ ${estimate.costBrl.toFixed(4).replace('.', ',')}`} />
              <Row label="Tempo estimado" value={`~${estimate.estimatedSeconds}s`} />
            </div>
              : <p className="text-sm leading-6 text-slate-500">Cole o conteúdo para calcular a estimativa real.</p>}
        </Card>

        <Alert tone="primary" title="Fluxo obrigatório">
          Gerar → revisar → aprovar/rejeitar → concluir. As {activeClassCount} turma(s) ativas são selecionadas na publicação do simulado, não na geração.
        </Alert>
      </aside>
    </div>

    {result ? <Card title="2. Revisar e concluir" description="As aprovadas serão copiadas. As rejeitadas e ainda em revisão serão removidas do lote.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Geradas" value={result.questionCount} />
        <Metric label="Aprovadas" value={approvedCount} />
        <Metric label="Em revisão" value={reviewCount} />
        <Metric label="Rejeitadas" value={rejectedCount} />
        <Metric label="Custo real" value={`R$ ${result.actualCostBrl.toFixed(4).replace('.', ',')}`} />
        <Metric label="Duração" value={`${(result.durationMs / 1000).toFixed(1)}s`} />
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Destino: <b className="text-slate-900">{selectedTarget?.title || (result.targetQuizId ? editableQuizzes.find((item) => item.id === result.targetQuizId)?.title : null) || 'Banco de questões da matéria'}</b>
      </div>
      <div className="mt-5 flex justify-end">
        <button className="app-button-primary" onClick={finalizeReview} disabled={finalizing || Boolean(busyId)}>
          <Icon name={finalizing ? 'refresh' : 'check'} className={`h-4 w-4 ${finalizing ? 'animate-spin' : ''}`} />
          {finalizing ? 'Concluindo...' : 'Concluir revisão'}
        </button>
      </div>
    </Card> : null}

    {questions.length ? <Card title="Questões do lote" description={`${approvedCount} aprovada(s), ${reviewCount} em revisão e ${rejectedCount} rejeitada(s).`}>
      <div className="space-y-4">{questions.map((question, index) => {
        const editing = editingId === question.id;
        return <article key={question.id} className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Questão {index + 1}</Badge>
              <Badge>{question.topic}</Badge>
              <Badge tone={question.difficulty === 'easy' ? 'success' : question.difficulty === 'hard' ? 'danger' : 'warning'}>{difficultyLabel(question.difficulty)}</Badge>
            </div>
            <StatusBadge status={question.reviewStatus} />
          </div>

          {editing ? <div className="mt-5 space-y-4">
            <textarea className="app-input min-h-28" value={question.statement} onChange={(event) => updateQuestion(question.id, { statement: event.target.value })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="app-input" value={question.topic} onChange={(event) => updateQuestion(question.id, { topic: event.target.value })} placeholder="Tema" />
              <input className="app-input" value={question.subtopic} onChange={(event) => updateQuestion(question.id, { subtopic: event.target.value })} placeholder="Subtema" />
              <select className="app-input" value={question.difficulty} onChange={(event) => updateQuestion(question.id, { difficulty: event.target.value as ApiQuestion['difficulty'] })}>
                <option value="easy">Fácil</option><option value="medium">Média</option><option value="hard">Difícil</option>
              </select>
            </div>
            {question.options.map((option, optionIndex) => <div key={option.label} className="grid grid-cols-[42px_1fr_auto] gap-3">
              <span className="flex items-center justify-center rounded-lg border border-slate-200 bg-white font-bold">{option.label}</span>
              <input className="app-input" value={option.text} onChange={(event) => updateOption(question.id, optionIndex, event.target.value)} />
              <label className="flex items-center gap-2 text-xs text-slate-500"><input type="radio" checked={question.correct_label === option.label} onChange={() => updateQuestion(question.id, { correct_label: option.label })} className="accent-orange-500" /> correta</label>
            </div>)}
            <textarea className="app-input min-h-24" value={question.explanation_correct} onChange={(event) => updateQuestion(question.id, { explanation_correct: event.target.value })} placeholder="Explicação da correta" />
            <textarea className="app-input min-h-24" value={question.explanation_wrong} onChange={(event) => updateQuestion(question.id, { explanation_wrong: event.target.value })} placeholder="Explicação das incorretas" />
          </div> : <>
            <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-900">{question.statement}</p>
            <div className="mt-4 grid gap-2 md:grid-cols-2">{question.options.map((option) => <div key={option.label} className={`flex gap-3 rounded-lg border p-3 text-sm ${option.label === question.correct_label ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}><b>{option.label}</b><span>{option.text}</span></div>)}</div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600"><b className="text-slate-900">Justificativa:</b> {question.explanation_correct}</div>
          </>}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button className="app-button-secondary" onClick={() => regenerateQuestion(question)} disabled={busyId === question.id || finalizing}><Icon name="refresh" className={`h-4 w-4 ${busyId === question.id ? 'animate-spin' : ''}`} /> Regenerar</button>
            {editing ? <>
              <button className="app-button-secondary" onClick={() => setEditingId(null)}>Cancelar</button>
              <button className="app-button-primary" onClick={() => saveQuestion(question)} disabled={busyId === question.id}><Icon name="save" className="h-4 w-4" /> Salvar</button>
            </> : <button className="app-button-secondary" onClick={() => setEditingId(question.id)}><Icon name="edit" className="h-4 w-4" /> Editar</button>}
            {question.reviewStatus !== 'approved'
              ? <button className="app-button-primary" onClick={() => reviewQuestion(question, 'approved')} disabled={Boolean(busyId)}><Icon name="check" className="h-4 w-4" /> Aprovar</button>
              : <button className="app-button-secondary" onClick={() => reviewQuestion(question, 'review')} disabled={Boolean(busyId)}>Reabrir</button>}
            <button className="app-button-danger" onClick={() => reviewQuestion(question, 'rejected')} disabled={Boolean(busyId)}><Icon name="x" className="h-4 w-4" /> Rejeitar</button>
          </div>
        </article>;
      })}</div>
    </Card> : null}

    <Card title="Histórico de gerações" description="Dados reais de tokens, custos, duração, modelo e status." padding={false}>
      <div className="overflow-x-auto"><table className="app-table min-w-[1040px]"><thead><tr><th>Fonte</th><th>Matéria</th><th>Questões</th><th>Status</th><th>Modelo</th><th>Tokens</th><th>Estimado</th><th>Real</th><th>Duração</th><th>Data</th><th>Ações</th></tr></thead><tbody>
        {jobs.map((job) => <tr key={job.id}>
          <td><b className="text-slate-900">{job.title}</b></td><td><Badge>{job.subject}</Badge></td><td>{job.questionCount}</td><td><StatusBadge status={job.status} /></td><td>{job.model || '—'}</td><td>{job.inputTokens ?? '—'} / {job.outputTokens ?? '—'}</td><td>{job.preEstimatedCostUsd === null ? '—' : `US$ ${job.preEstimatedCostUsd.toFixed(6)}`}</td><td>{job.actualCostUsd === null ? '—' : `US$ ${job.actualCostUsd.toFixed(6)}`}</td><td>{job.durationMs === null ? '—' : `${(job.durationMs / 1000).toFixed(1)}s`}</td><td>{formatDate(job.createdAt, true)}</td><td>{job.status === 'ready_for_review' && job.quizId ? <button type="button" className="app-button-secondary whitespace-nowrap" onClick={() => resumeReview(job)} disabled={loadingJobId === job.id || Boolean(result)}><Icon name={loadingJobId === job.id ? 'refresh' : 'edit'} className={`h-4 w-4 ${loadingJobId === job.id ? 'animate-spin' : ''}`} /> Continuar revisão</button> : '—'}</td>
        </tr>)}
      </tbody></table></div>
    </Card>
  </div>;
}

function difficultyLabel(value: ApiQuestion['difficulty']) {
  return value === 'easy' ? 'Fácil' : value === 'hard' ? 'Difícil' : 'Média';
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-slate-200 pb-3 last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><b className="text-slate-900">{value}</b></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-900">{value}</p></div>;
}
