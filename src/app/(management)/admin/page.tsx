import Link from 'next/link';
import { Card, MiniBarChart, PageHeader, ProgressBar, Sparkline, StatCard, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getAdminOverview } from '@/server/data/admin';
import { formatDate, formatDuration, formatScore } from '@/lib/format';

export default async function AdminDashboardPage() {
  const data = await getAdminOverview();
  const isTeacher = data.role === 'teacher';
  const topClasses = data.classes.filter((item) => item.status === 'active').slice(0, 5);
  const recentQuizzes = data.quizzes.slice(0, 6);
  const subjectOpportunities = data.subjects
    .slice()
    .sort((a, b) => a.average - b.average)
    .slice(0, 6)
    .map((item) => ({
      label: item.name,
      value: Math.max(0, 100 - item.average),
      secondary: `${formatScore(item.average)} média`,
    }));

  const headerActions = (
    <>
      <a href="/api/admin/exports/reports" className="app-button-secondary">
        <Icon name="download" className="h-4 w-4" /> Exportar
      </a>
      {!isTeacher ? (
        <Link href="/admin/alunos/importar" className="app-button-secondary">
          <Icon name="upload" className="h-4 w-4" /> Importar alunos
        </Link>
      ) : null}
      <Link href="/admin/simulados/novo" className="app-button-primary">
        <Icon name="plus" className="h-4 w-4" /> Novo simulado
      </Link>
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={isTeacher ? 'Painel do professor' : 'Painel de gestão'}
        title="Visão geral"
        description={
          isTeacher
            ? 'Dados, simulados, turmas e questões limitados às suas matérias.'
            : 'Dados consolidados diretamente do Supabase da Nexo Avalia.'
        }
        actions={headerActions}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Alunos ativos"
          value={data.stats.activeStudents}
          icon="users"
          tone="primary"
          helper={`${data.students.length} perfis nas suas turmas`}
        />
        {isTeacher ? (
          <StatCard
            label="Matérias atribuídas"
            value={data.subjects.length}
            icon="book"
            tone="warning"
            helper="acesso restrito por matéria"
          />
        ) : (
          <StatCard
            label="Cadastros pendentes"
            value={data.stats.pendingStudents}
            icon="alert"
            tone="warning"
            helper="aguardando análise"
          />
        )}
        <StatCard
          label="Simulados publicados"
          value={data.stats.publishedQuizzes}
          icon="clipboard"
          tone="purple"
          helper={`${data.quizzes.length} no total`}
        />
        <StatCard
          label="Participação média"
          value={`${data.stats.participation.toLocaleString('pt-BR')}%`}
          icon="chart"
          tone="success"
          helper={`${data.stats.attempts} tentativas concluídas`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Engajamento nas avaliações" description="Tentativas concluídas nas últimas oito semanas">
          {data.weekly.some(Boolean) ? (
            <div className="h-52 text-white">
              <Sparkline values={data.weekly} className="h-full" />
            </div>
          ) : (
            <EmptyText text="Ainda não há tentativas concluídas para formar a série." />
          )}
          <div className="mt-5 grid grid-cols-4 border-t border-[#292929] pt-4 text-center text-xs text-[#777]">
            {[0, 2, 5, 7].map((index) => (
              <div key={index}>
                <p>Sem. {index + 1}</p>
                <p className="mt-1 font-bold text-white">{data.weekly[index] || 0}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Indicadores atuais" description="Calculados com registros reais">
          <div className="grid grid-cols-2 gap-4">
            <Metric label="Tentativas" value={data.stats.attempts} helper="concluídas" />
            <Metric label={isTeacher ? 'Média nas matérias' : 'Média geral'} value={formatScore(data.stats.average)} helper="normalizada" />
            <Metric label="Questões" value={data.stats.questions} helper="no banco" />
            <Metric label="Tempo médio" value={formatDuration(data.stats.averageDurationSeconds)} helper="por tentativa" />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Card
          title="Desempenho por turma"
          description={isTeacher ? 'Média e participação nas suas matérias' : 'Média e participação das turmas ativas'}
          action={<Link href="/admin/relatorios" className="text-sm font-semibold text-white hover:underline">Ver relatório</Link>}
        >
          {topClasses.length ? (
            <div className="space-y-5">
              {topClasses.map((item) => (
                <div key={item.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      {isTeacher ? (
                        <p className="text-sm font-semibold text-white">{item.name}</p>
                      ) : (
                        <Link href={`/admin/turmas/${item.id}`} className="text-sm font-semibold text-white hover:underline">{item.name}</Link>
                      )}
                      <p className="mt-0.5 text-xs text-[#777]">{item.students} alunos · {item.participation}% participação</p>
                    </div>
                    <b className="text-white">{formatScore(item.average)}</b>
                  </div>
                  <ProgressBar value={item.average} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyText text="Nenhuma turma ativa disponível." />
          )}
        </Card>
        <Card title="Oportunidade por matéria" description="Distância entre a média atual e 100 pontos">
          {subjectOpportunities.length ? (
            <MiniBarChart items={subjectOpportunities} max={100} />
          ) : (
            <EmptyText text="Ainda não há dados suficientes para visualizar." />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Simulados recentes"
          description="Status, turma e participação"
          padding={false}
          action={<Link href="/admin/simulados" className="text-sm font-semibold text-white hover:underline">Gerenciar</Link>}
        >
          {recentQuizzes.length ? (
            <div className="overflow-x-auto">
              <table className="app-table min-w-[760px]">
                <thead><tr><th>Simulado</th><th>Status</th><th>Questões</th><th>Participação</th><th>Prazo</th></tr></thead>
                <tbody>
                  {recentQuizzes.map((quiz) => (
                    <tr key={quiz.id}>
                      <td>
                        <Link href={`/admin/simulados/${quiz.id}`} className="font-semibold text-white hover:underline">{quiz.title}</Link>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: quiz.subjectColor }} />
                          <span className="text-xs text-[#777]">{quiz.subject} · {quiz.className}</span>
                        </div>
                      </td>
                      <td><StatusBadge status={quiz.status} /></td>
                      <td>{quiz.questionCount}</td>
                      <td>{quiz.participation}%</td>
                      <td>{quiz.dueAt ? formatDate(quiz.dueAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyText text="Nenhum simulado criado." />
          )}
        </Card>
        <Card
          title={isTeacher ? 'Minha atividade' : 'Atividade administrativa'}
          description={isTeacher ? 'Suas ações recentes na plataforma' : 'Eventos recentes da auditoria'}
          padding={false}
          action={!isTeacher ? <Link href="/admin/auditoria" className="text-sm font-semibold text-white hover:underline">Ver todos</Link> : undefined}
        >
          {data.auditLogs.length ? (
            <div className="divide-y divide-[#282828]">
              {data.auditLogs.map((log) => (
                <div key={log.id} className="flex gap-3 p-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#222] text-[#bbb]">
                    <Icon name={log.severity === 'warning' ? 'alert' : log.severity === 'success' ? 'check-circle' : 'shield'} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{log.actor}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#777]">{log.detail}</p>
                    <p className="mt-1 text-[10px] text-[#555]">{formatDate(log.date, true)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyText text="Nenhuma atividade recente." />
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <div className="rounded-md border border-[#2b2b2b] bg-[#1b1b1b] p-4">
      <p className="text-xs text-[#777]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#666]">{helper}</p>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="flex min-h-40 items-center justify-center text-center text-sm text-[#777]">{text}</div>;
}
