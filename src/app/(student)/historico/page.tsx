import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getStudentAttempts } from '@/server/data/student';
import { formatDate, formatDuration, formatScore } from '@/lib/format';

export default async function HistoryPage() {
  const attempts = await getStudentAttempts();
  const submitted = attempts.filter((item: any) => item.status === 'submitted');
  const scores = submitted.map((item: any) => Number(item.score_normalized || 0));
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const totalSeconds = submitted.reduce((sum: number, item: any) => sum + Number(item.duration_seconds || 0), 0);

  return (
    <>
      <PageHeader eyebrow="Resultados" title="Histórico de tentativas" description="Consulte todas as tentativas registradas no banco de dados e revise as correções concluídas." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tentativas" value={attempts.length} icon="history" tone="primary" />
        <StatCard label="Concluídas" value={submitted.length} icon="check-circle" tone="success" />
        <StatCard label="Nota média" value={formatScore(average)} icon="target" tone="purple" />
        <StatCard label="Tempo total" value={formatDuration(totalSeconds)} icon="clock" tone="neutral" />
      </div>

      <Card className="mt-6" title="Todas as tentativas" description="Ordenadas da mais recente para a mais antiga" padding={false}>
        <div className="overflow-x-auto">
          <table className="app-table min-w-[900px]">
            <thead><tr><th>Simulado</th><th>Matéria</th><th>Status</th><th>Nota</th><th>Acertos</th><th>Tempo</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {attempts.map((attempt: any) => (
                <tr key={attempt.id}>
                  <td><p className="font-semibold text-white">{attempt.quizTitle}</p><p className="mt-1 text-xs text-[#777]">ID da tentativa: {String(attempt.id).slice(0, 8)}</p></td>
                  <td><Badge><i className="h-2 w-2 rounded-full" style={{ background: attempt.subjectColor }} />{attempt.subject}</Badge></td>
                  <td><StatusBadge status={attempt.status} /></td>
                  <td className="font-semibold text-white">{formatScore(attempt.score_normalized)}</td>
                  <td>{attempt.status === 'submitted' ? `${Number(attempt.correct_count || 0)} / ${Number(attempt.correct_count || 0) + Number(attempt.wrong_count || 0)}` : '—'}</td>
                  <td>{formatDuration(Number(attempt.duration_seconds || 0))}</td>
                  <td>{formatDate(attempt.submitted_at || attempt.started_at, true)}</td>
                  <td className="text-right">
                    {attempt.status === 'submitted' ? <Link href={`/historico/${attempt.id}`} className="app-button-secondary px-3 py-2"><Icon name="eye" className="h-4 w-4" /> Revisar</Link> : <Link href={`/simulados/${attempt.quiz_id}/realizar?attemptId=${attempt.id}`} className="app-button-primary px-3 py-2"><Icon name="play" className="h-4 w-4" /> Continuar</Link>}
                  </td>
                </tr>
              ))}
              {!attempts.length ? <tr><td colSpan={8}><EmptyState icon="history" title="Histórico vazio" description="Suas tentativas serão registradas aqui assim que você iniciar um simulado." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
