import Link from 'next/link';
import { Alert, Badge, Card, Donut, EmptyState, PageHeader, ProgressBar, StatCard } from '@/components/ui';
import { Icon } from '@/components/icon';
import { formatDate, formatDuration } from '@/lib/format';

type ResultQuestion = {
  id: string;
  statement: string;
  topic: string | null;
  subtopic: string | null;
  difficulty: string;
  position: number;
  options: Array<{ id: string; label: string; option_text: string }>;
  answer: { selected_option_id: string | null; elapsed_seconds: number | null; is_correct: boolean | null; points_awarded: number | null } | null;
  key: { correct_option_id: string; explanation_correct: string; explanation_wrong: string | null } | null;
};

type ResultData = {
  attempt: { id: string; status: string; started_at: string; submitted_at: string | null; duration_seconds: number | null; score_raw: number | null; score_normalized: number | null; correct_count: number | null; wrong_count: number | null };
  quiz: { id: string; title: string; description: string | null; subject: string; subjectColor: string };
  questions: ResultQuestion[];
};

export function ResultView({ data, backHref = '/historico' }: { data: ResultData; backHref?: string }) {
  const { attempt, quiz, questions } = data;
  const score = Number(attempt.score_normalized || 0);
  const correct = Number(attempt.correct_count || 0);
  const wrong = Number(attempt.wrong_count || 0);
  const blank = Math.max(0, questions.length - correct - wrong);
  return <><PageHeader backHref={backHref} eyebrow={quiz.subject} title={`Resultado — ${quiz.title}`} description={attempt.submitted_at ? `Entregue em ${formatDate(attempt.submitted_at, true)}` : 'Tentativa ainda não concluída.'} actions={<Link href="/simulados" className="app-button-secondary"><Icon name="clipboard" className="h-4 w-4" /> Ver simulados</Link>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Nota" value={score.toFixed(1)} icon="target" tone="primary" /><StatCard label="Acertos" value={correct} icon="check-circle" tone="success" /><StatCard label="Erros" value={wrong} icon="x" tone="danger" /><StatCard label="Tempo" value={formatDuration(Number(attempt.duration_seconds || 0))} icon="clock" tone="neutral" /></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[.75fr_1.25fr]"><Card title="Resumo"><div className="flex flex-col items-center"><Donut value={score} label="nota" size={170} color={quiz.subjectColor} /><div className="mt-6 w-full space-y-4"><ProgressBar value={correct} max={Math.max(1, questions.length)} label={`${correct} corretas`} color="#34d399" /><ProgressBar value={wrong} max={Math.max(1, questions.length)} label={`${wrong} incorretas`} color="#f87171" /><ProgressBar value={blank} max={Math.max(1, questions.length)} label={`${blank} em branco`} color="#777" /></div></div></Card><Card title="Leitura pedagógica"><p className="text-sm leading-7 text-slate-600">A correção abaixo utiliza o gabarito oficial salvo no banco. Revise principalmente as questões incorretas e os temas com menor domínio.</p>{score >= 80 ? <div className="mt-5"><Alert tone="success" title="Excelente desempenho">Você atingiu uma pontuação alta neste simulado.</Alert></div> : score >= 60 ? <div className="mt-5"><Alert tone="warning" title="Bom caminho">Revise os erros para consolidar os temas.</Alert></div> : <div className="mt-5"><Alert tone="danger" title="Revisão prioritária">Use as explicações e retome os tópicos com maior dificuldade.</Alert></div>}</Card></div>
    <Card className="mt-6" title="Correção detalhada" description="Alternativas selecionadas, gabarito e explicações" padding={false}><div className="divide-y divide-[#292929]">{questions.map((question, index) => { const selectedId = question.answer?.selected_option_id; const correctId = question.key?.correct_option_id; return <article key={question.id} className="p-5 sm:p-7"><div className="flex flex-wrap items-center gap-2"><Badge>Questão {index + 1}</Badge><Badge>{question.topic || 'Sem tema'}</Badge><Badge tone={question.difficulty === 'easy' ? 'success' : question.difficulty === 'hard' ? 'danger' : 'warning'}>{difficultyLabel(question.difficulty)}</Badge>{question.answer?.is_correct ? <Badge tone="success">Correta</Badge> : selectedId ? <Badge tone="danger">Incorreta</Badge> : <Badge tone="warning">Em branco</Badge>}<Badge>{formatDuration(Number(question.answer?.elapsed_seconds || 0))}</Badge></div><p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-900">{question.statement}</p><div className="mt-4 grid gap-2 md:grid-cols-2">{question.options.map((option) => { const isCorrect = option.id === correctId; const isSelected = option.id === selectedId; return <div key={option.id} className={`rounded-lg border p-3 text-sm ${isCorrect ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800' : isSelected ? 'border-red-500/40 bg-red-500/10 text-red-100' : 'border-slate-200 bg-white text-slate-500'}`}><b className="mr-2">{option.label}</b>{option.option_text}{isCorrect ? <span className="ml-2 text-xs font-bold">Gabarito</span> : isSelected ? <span className="ml-2 text-xs font-bold">Sua resposta</span> : null}</div>; })}</div>{question.key ? <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600"><b className="text-slate-900">Explicação:</b> {question.answer?.is_correct ? question.key.explanation_correct : question.key.explanation_wrong || question.key.explanation_correct}</div> : null}</article>; })}{!questions.length ? <EmptyState icon="clipboard" title="Sem questões" description="Não há conteúdo disponível para esta tentativa." /> : null}</div></Card>
  </>;
}


function difficultyLabel(value: string): string {
  if (value === 'easy') return 'Fácil';
  if (value === 'hard') return 'Difícil';
  return 'Médio';
}
