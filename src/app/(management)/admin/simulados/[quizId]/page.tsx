import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, EmptyState, PageHeader, ProgressBar, StatCard, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { QuizSettingsEditor } from '@/components/quiz-settings-editor';
import { getClasses, getQuestions, getQuizzes, getSubjects } from '@/server/data/admin';
import { formatDate } from '@/lib/format';

export default async function QuizDetailsPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const [quizzes, allQuestions, classes, subjects] = await Promise.all([getQuizzes(), getQuestions(), getClasses(), getSubjects()]);
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) notFound();
  const questions = allQuestions.filter((item) => item.quizId === quiz.id);
  const approved = questions.filter((item) => item.reviewStatus === 'approved');
  const readiness = [questions.length > 0, approved.length === questions.length && questions.length > 0, quiz.classIds.length > 0 || quiz.subjectIds.length > 0, Boolean(quiz.releaseAt && quiz.dueAt)];
  const percent = Math.round((readiness.filter(Boolean).length / readiness.length) * 100);

  return <>
    <PageHeader
      backHref="/admin/simulados"
      eyebrow={quiz.subject}
      title={quiz.title}
      description={quiz.description || 'Sem descrição.'}
      actions={<>
        <a href="/api/admin/exports/quizzes" className="app-button-secondary"><Icon name="download" className="h-4 w-4" /> Exportar</a>
        <Link href={`/admin/simulados/${quiz.id}/questoes`} className="app-button-secondary"><Icon name="edit" className="h-4 w-4" /> Editar questões</Link>
        {quiz.canEdit ? <Link href={`/admin/simulados/${quiz.id}/publicacao`} className="app-button-primary"><Icon name="check-circle" className="h-4 w-4" /> Publicação</Link> : null}
      </>}
    />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Questões" value={questions.length} icon="clipboard" tone="primary" helper={`${approved.length} aprovadas`} />
      <StatCard label="Tentativas" value={quiz.attempts} icon="users" tone="neutral" helper={`limite de ${quiz.maxAttempts} por aluno`} />
      <StatCard label="Média" value={quiz.average.toFixed(1)} icon="target" tone="success" />
      <StatCard label="Participação" value={`${quiz.participation}%`} icon="chart" tone="purple" />
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_.75fr]">
      <div className="space-y-6">
        {quiz.canEdit ? <QuizSettingsEditor quiz={quiz} classes={classes} subjects={subjects} /> : <Alert tone="primary" title="Acesso por matéria">Este simulado possui matérias fora da sua atribuição. Você pode visualizar os dados e editar apenas as questões da sua matéria, mas as configurações gerais e a publicação ficam com a coordenação.</Alert>}
        <Card title="Configuração atual">
          <div className="grid gap-5 sm:grid-cols-2">
            <Info label="Status" node={<StatusBadge status={quiz.status} />} />
            <Info label="Matérias" value={quiz.subjectNames.join(', ')} />
            <Info label="Turmas" value={quiz.classNames.length ? quiz.classNames.join(', ') : 'Acesso por matéria'} />
            <Info label="Duração" value={`${quiz.durationMinutes} minutos`} />
            <Info label="Tentativas" value={`${quiz.maxAttempts} por aluno`} />
            <Info label="Questões planejadas" value={String(quiz.plannedQuestionCount)} />
            <Info label="Liberação" value={quiz.releaseAt ? formatDate(quiz.releaseAt, true) : 'Não definida'} />
            <Info label="Prazo" value={quiz.dueAt ? formatDate(quiz.dueAt, true) : 'Não definido'} />
          </div>
        </Card>
        <Card title="Questões" description="Amostra do conteúdo salvo no banco" padding={false}>
          <div className="divide-y divide-[#292929]">
            {questions.slice(0, 8).map((question, index) => <div key={question.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><Badge>#{index + 1}</Badge><Badge>{question.topic}</Badge><StatusBadge status={question.reviewStatus} /></div><p className="mt-3 line-clamp-3 text-sm leading-6 text-[#ddd]">{question.statement}</p></div>)}
            {!questions.length ? <EmptyState icon="clipboard" title="Nenhuma questão" description="Cadastre ou gere questões para este simulado." action={<Link href={`/admin/simulados/${quiz.id}/questoes`} className="app-button-primary">Adicionar questões</Link>} /> : null}
          </div>
        </Card>
        {quiz.status === 'published' ? <Card title="Acompanhamento"><ProgressBar value={quiz.participation} label="Participação da turma" /><div className="mt-5 flex gap-3"><Link href={`/admin/relatorios?quizId=${quiz.id}`} className="app-button-secondary"><Icon name="chart" className="h-4 w-4" /> Relatórios</Link><Link href={`/admin/rankings?quizId=${quiz.id}`} className="app-button-secondary"><Icon name="trophy" className="h-4 w-4" /> Ranking</Link></div></Card> : null}
      </div>
      <aside className="space-y-6">
        <Card title="Prontidão"><div className="flex items-center justify-between"><span className="text-sm text-[#777]">Progresso</span><span className="text-2xl font-black text-white">{percent}%</span></div><ProgressBar value={percent} className="mt-3" /><div className="mt-5 space-y-3">{[['Questões cadastradas', readiness[0]], ['Questões aprovadas', readiness[1]], ['Público definido', readiness[2]], ['Período definido', readiness[3]]].map(([label, ok]) => <div key={String(label)} className="flex items-center gap-3 text-sm"><Icon name={ok ? 'check-circle' : 'alert'} className={`h-5 w-5 ${ok ? 'text-emerald-300' : 'text-amber-300'}`} /><span className="text-[#ccc]">{label}</span></div>)}</div></Card>
        {quiz.attempts > 0 ? <Alert tone="warning" title="Histórico protegido">Este simulado possui respostas. Configurações podem ser alteradas, mas as questões só podem ser modificadas em uma nova versão.</Alert> : <Alert tone="primary">Questões de um simulado publicado sem respostas são reabertas automaticamente para edição.</Alert>}
      </aside>
    </div>
  </>;
}

function Info({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return <div><p className="text-xs text-[#777]">{label}</p><div className="mt-1 font-bold text-white">{node || value}</div></div>;
}
