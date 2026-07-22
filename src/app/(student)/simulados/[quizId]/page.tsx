import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { StartQuizButton } from '@/components/start-quiz-button';
import { getStudentQuiz } from '@/server/data/student';
import { formatDate } from '@/lib/format';

export default async function QuizDetailsPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const data = await getStudentQuiz(quizId);
  if (!data) notFound();
  const { quiz, questions } = data;
  const topics = [...new Set(questions.map((item) => item.topic).filter(Boolean))];
  const inProgress = quiz.participation > 0 && quiz.participation < 100;

  return (
    <>
      <PageHeader
        backHref="/simulados"
        eyebrow={quiz.subjectNames.join(' • ') || quiz.subject}
        title={quiz.title}
        description={quiz.description || undefined}
        actions={<StatusBadge status={inProgress ? 'in_progress' : 'published'} />}
      />

      <div className="grid gap-6 xl:grid-cols-[1.45fr_.75fr]">
        <div className="space-y-6">
          <Card title="Sobre este simulado" description="Confira as informações essenciais e inicie quando estiver pronto.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info icon="clipboard" label="Questões" value={String(quiz.questionCount)} />
              <Info icon="clock" label="Tempo sugerido" value={`${quiz.durationMinutes} min`} />
              <Info icon="graduation" label="Turmas" value={quiz.classNames.length ? quiz.classNames.join(', ') : 'Disponível por matéria'} />
              <Info icon="history" label="Tentativas concluídas" value={String(quiz.attempts)} />
            </div>

            {topics.length ? (
              <div className="mt-6 border-t border-[#292929] pt-5">
                <h3 className="font-semibold text-white">Conteúdos avaliados</h3>
                <div className="mt-3 flex flex-wrap gap-2">{topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}</div>
              </div>
            ) : null}
          </Card>

          <Card title="Regras da atividade">
            <ul className="space-y-3 text-sm leading-6 text-[#aaa]">
              {[
                'As respostas são salvas automaticamente durante a execução.',
                'Você pode navegar entre as questões antes de finalizar.',
                'A correção usa o gabarito oficial aprovado pela equipe pedagógica.',
                'Os níveis das questões são exibidos somente depois da entrega.',
                'Uma tentativa em andamento é retomada automaticamente.'
              ].map((rule) => <li key={rule} className="flex gap-3"><Icon name="check-circle" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><span>{rule}</span></li>)}
            </ul>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Disponibilidade">
            <div className="space-y-4 text-sm text-[#aaa]">
              <Meta icon="calendar" label="Liberação" value={quiz.releaseAt ? formatDate(quiz.releaseAt, true) : 'Imediata'} />
              <Meta icon="clock" label="Prazo" value={quiz.dueAt ? formatDate(quiz.dueAt, true) : 'Sem prazo definido'} />
              <Meta icon="users" label="Turmas" value={quiz.classNames.length ? quiz.classNames.join(', ') : 'Acesso por matéria'} />
              <Meta icon="graduation" label="Matérias" value={quiz.subjectNames.join(', ') || quiz.subject} />
            </div>
            {inProgress ? <ProgressBar value={quiz.participation} label="Tentativa em andamento" className="mt-5" color={quiz.subjectColor} /> : null}
            <div className="mt-6"><StartQuizButton quizId={quiz.id} label={inProgress ? 'Retomar tentativa' : 'Iniciar simulado'} /></div>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Info({ icon, label, value }: { icon: 'clipboard' | 'clock' | 'graduation' | 'history'; label: string; value: string }) {
  return <div className="rounded-md border border-[#303030] bg-[#171717] p-4"><Icon name={icon} className="h-5 w-5 text-white" /><p className="mt-3 text-xs text-[#777]">{label}</p><p className="mt-1 text-base font-semibold text-white" title={value}>{value}</p></div>;
}
function Meta({ icon, label, value }: { icon: 'calendar' | 'clock' | 'users' | 'graduation'; label: string; value: string }) {
  return <div className="flex items-start gap-3"><Icon name={icon} className="mt-0.5 h-5 w-5 text-[#777]" /><div><p className="text-xs text-[#777]">{label}</p><p className="mt-1 font-medium text-white">{value}</p></div></div>;
}
