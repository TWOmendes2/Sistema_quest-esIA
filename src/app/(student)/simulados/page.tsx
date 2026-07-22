import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getStudentQuizzes } from '@/server/data/student';
import { formatDate, formatScore } from '@/lib/format';

export default async function QuizzesPage() {
  const quizzes = await getStudentQuizzes();
  const available = quizzes.filter((quiz) => quiz.attempts === 0 || quiz.participation < 100);
  const completed = quizzes.filter((quiz) => quiz.attempts > 0);

  return (
    <>
      <PageHeader
        eyebrow="Avaliações"
        title="Meus simulados"
        description="Acesse as avaliações publicadas para suas turmas. Todas as informações abaixo vêm do banco de dados da Nexo Avalia."
      />

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Disponíveis agora</h2>
            <p className="mt-1 text-sm text-[#858585]">{available.length} atividade(s) liberada(s)</p>
          </div>
          <Badge tone="primary">Atualização em tempo real</Badge>
        </div>

        {available.length ? (
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {available.map((quiz) => (
              <Card key={quiz.id} className="flex flex-col overflow-hidden" padding={false}>
                <div className="h-1" style={{ background: quiz.subjectColor }} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Badge><i className="h-2 w-2 rounded-full" style={{ background: quiz.subjectColor }} />{quiz.subject}</Badge>
                    <StatusBadge status={quiz.participation > 0 && quiz.participation < 100 ? 'in_progress' : 'published'} />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold leading-6 text-white">{quiz.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#8f8f8f]">{quiz.description || 'Simulado publicado pela equipe pedagógica.'}</p>

                  <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-[#a0a0a0]">
                    <span className="inline-flex items-center gap-2"><Icon name="clipboard" className="h-4 w-4 text-[#666]" />{quiz.questionCount} questões</span>
                    <span className="inline-flex items-center gap-2"><Icon name="clock" className="h-4 w-4 text-[#666]" />{quiz.durationMinutes} minutos</span>
                    <span className="inline-flex items-center gap-2"><Icon name="graduation" className="h-4 w-4 text-[#666]" />{quiz.className}</span>
                    <span className="inline-flex items-center gap-2"><Icon name="calendar" className="h-4 w-4 text-[#666]" />{quiz.dueAt ? `Até ${formatDate(quiz.dueAt)}` : 'Sem prazo'}</span>
                  </div>

                  {quiz.participation > 0 && quiz.participation < 100 ? (
                    <ProgressBar value={quiz.participation} label="Tentativa em andamento" className="mt-5" color={quiz.subjectColor} />
                  ) : null}
                </div>
                <div className="border-t border-[#292929] p-4">
                  <Link href={`/simulados/${quiz.id}`} className="app-button-primary w-full">
                    {quiz.participation > 0 && quiz.participation < 100 ? 'Continuar simulado' : 'Ver detalhes'}
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card padding={false}><EmptyState icon="clipboard" title="Nenhum simulado disponível" description="Quando uma avaliação for publicada para sua turma, ela aparecerá aqui." /></Card>
        )}
      </section>

      <section className="mt-9">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Já realizados</h2>
          <p className="mt-1 text-sm text-[#858585]">Melhor nota consolidada por simulado</p>
        </div>
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="app-table min-w-[820px]">
              <thead><tr><th>Simulado</th><th>Matéria</th><th>Turma</th><th>Tentativas</th><th>Melhor nota</th><th></th></tr></thead>
              <tbody>
                {completed.map((quiz) => (
                  <tr key={quiz.id}>
                    <td><p className="font-semibold text-white">{quiz.title}</p><p className="mt-1 text-xs text-[#777]">{quiz.questionCount} questões · {quiz.durationMinutes} min</p></td>
                    <td><Badge><i className="h-2 w-2 rounded-full" style={{ background: quiz.subjectColor }} />{quiz.subject}</Badge></td>
                    <td>{quiz.className}</td>
                    <td>{quiz.attempts}</td>
                    <td><span className="text-base font-semibold text-white">{formatScore(quiz.average)}</span></td>
                    <td className="text-right"><Link href="/historico" className="app-button-secondary px-3 py-2"><Icon name="history" className="h-4 w-4" /> Histórico</Link></td>
                  </tr>
                ))}
                {!completed.length ? <tr><td colSpan={6}><EmptyState icon="history" title="Nenhum resultado ainda" description="Seus simulados concluídos aparecerão nesta lista." /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </>
  );
}
