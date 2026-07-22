import Link from "next/link";
import {
  Avatar,
  Badge,
  Card,
  Donut,
  EmptyState,
  MiniBarChart,
  PageHeader,
  ProgressBar,
  Sparkline,
  StatCard,
} from "@/components/ui";
import { Icon } from "@/components/icon";
import { getReportsData } from "@/server/data/admin";
import { formatDate, formatDuration, formatScore } from "@/lib/format";

type SearchParams = { classId?: string; quizId?: string; subjectId?: string };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters = {
    classId: clean(params.classId),
    quizId: clean(params.quizId),
    subjectId: clean(params.subjectId),
  };
  const data = await getReportsData(filters);
  const { stats, weekly } = data.overview;
  const topicRows = data.topics.slice(0, 20);
  const rankingRows = data.rankings.slice(0, 20);
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value)) as string[][],
  ).toString();

  return (
    <>
      <PageHeader
        eyebrow="Inteligência pedagógica"
        title="Relatórios e indicadores"
        description="Filtre exatamente por turma, simulado e matéria para analisar todas as respostas submetidas."
        actions={
          <a
            href={`/api/admin/exports/reports${exportQuery ? `?${exportQuery}` : ""}`}
            className="app-button-primary"
          >
            <Icon name="download" className="h-4 w-4" /> Exportar CSV
          </a>
        }
      />

      <form
        method="get"
        className="app-card mb-6 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4"
      >
        <Filter
          label="Turma"
          name="classId"
          value={filters.classId || ""}
          options={data.options.classes.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <Filter
          label="Simulado"
          name="quizId"
          value={filters.quizId || ""}
          options={data.options.quizzes.map((item) => ({
            value: item.id,
            label: item.title,
          }))}
        />
        <Filter
          label="Matéria"
          name="subjectId"
          value={filters.subjectId || ""}
          options={data.options.subjects.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <div className="flex items-end gap-2">
          <button className="app-button-primary flex-1">
            <Icon name="filter" className="h-4 w-4" /> Aplicar filtros
          </button>
          <Link
            href="/admin/relatorios"
            className="app-button-secondary px-3"
            aria-label="Limpar filtros"
          >
            <Icon name="refresh" className="h-4 w-4" />
          </Link>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Participação"
          value={`${stats.participation}%`}
          icon="users"
          tone="success"
          helper={`${stats.students} alunos · ${stats.attempts} respostas`}
        />
        <StatCard
          label="Média"
          value={formatScore(stats.average)}
          icon="target"
          tone="primary"
          helper={`${formatScore(stats.accuracy)}% de acerto`}
        />
        <StatCard
          label="Acertos / erros"
          value={`${stats.totalCorrect} / ${stats.totalWrong}`}
          icon="check-circle"
          tone="purple"
        />
        <StatCard
          label="Tempo médio"
          value={formatDuration(stats.averageDurationSeconds)}
          icon="clock"
          tone="neutral"
          helper={`${stats.questions} questões no escopo`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card
          title="Atividade nas últimas oito semanas"
          description="Tentativas enviadas dentro dos filtros selecionados"
        >
          <div className="h-52 text-white">
            <Sparkline values={weekly} className="h-full" />
          </div>
          <div className="mt-4 flex justify-between border-t border-[#2d2d2d] pt-4 text-xs text-[#777]">
            <span>8 semanas atrás</span>
            <b className="text-white">
              {weekly.reduce((sum, value) => sum + value, 0)} envios
            </b>
            <span>Semana atual</span>
          </div>
        </Card>
        <Card
          title="Distribuição consolidada"
          description="Desempenho de todas as respostas submetidas"
        >
          <div className="flex flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row">
            <Donut value={stats.average} label="média" size={150} />
            <div className="w-full space-y-4">
              <ProgressBar value={stats.participation} label="Participação" />
              <ProgressBar value={stats.average} label="Pontuação média" />
              <ProgressBar value={stats.accuracy} label="Precisão" />
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card
          title="Desempenho por turma"
          description="Média e participação calculadas apenas para o escopo atual"
        >
          <div className="space-y-5">
            {data.classes.map((item) => (
              <div key={item.id}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[#777]">
                      {item.students} alunos · {item.attempts} respostas ·{" "}
                      {item.participation}% participação
                    </p>
                  </div>
                  <b>{formatScore(item.average)}</b>
                </div>
                <ProgressBar value={item.average} color="#fff" />
              </div>
            ))}
            {!data.classes.length ? (
              <EmptyState
                icon="graduation"
                title="Sem turmas no filtro"
                description="Selecione outro escopo ou vincule simulados às turmas."
              />
            ) : null}
          </div>
        </Card>
        <Card
          title="Matérias com maior oportunidade"
          description="Distância para a meta de 80 pontos"
        >
          <MiniBarChart
            items={data.subjects.map((subject) => ({
              label: subject.name,
              value: Math.max(0, 80 - subject.average),
              secondary: `${formatScore(subject.average)} média · ${subject.attempts} respostas`,
            }))}
            max={Math.max(
              1,
              ...data.subjects.map((item) => Math.max(0, 80 - item.average)),
            )}
          />
        </Card>
      </div>

      <Card
        className="mt-6"
        title="Quem mais acertou"
        description="Ranking pontual considerando todas as respostas do filtro"
        padding={false}
      >
        {rankingRows.length ? (
          <div className="overflow-x-auto">
            <table className="app-table min-w-[1040px]">
              <thead>
                <tr>
                  <th>Posição</th>
                  <th>Apelido</th>
                  <th>Turma / simulado</th>
                  <th>Acertos</th>
                  <th>Erros</th>
                  <th>Pontuação</th>
                  <th>Precisão</th>
                  <th>Envio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rankingRows.map((item) => (
                  <tr key={item.id}>
                    <td className="font-black">#{item.position}</td>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={item.nickname} size="sm" />
                        <span className="font-bold text-white">
                          @{item.nickname}
                        </span>
                      </div>
                    </td>
                    <td>
                      <p className="font-bold text-white">{item.quiz}</p>
                      <p className="mt-1 text-xs text-[#777]">
                        {item.className} · {item.subject}
                      </p>
                    </td>
                    <td className="font-black text-emerald-300">
                      {item.correct}
                    </td>
                    <td className="font-black text-rose-300">{item.wrong}</td>
                    <td>{formatScore(item.score)}</td>
                    <td>{formatScore(item.accuracy)}%</td>
                    <td>
                      {item.submittedAt
                        ? formatDate(item.submittedAt, true)
                        : "—"}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/admin/alunos/${item.studentId}`}
                        className="app-button-secondary px-3 py-2"
                      >
                        <Icon name="eye" className="h-4 w-4" /> Detalhes
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="chart"
            title="Sem respostas no filtro"
            description="Os resultados serão exibidos após a conclusão de tentativas."
          />
        )}
      </Card>

      <Card
        className="mt-6"
        title="Matriz real de tópicos"
        description="Taxa de acerto calculada somente nas respostas filtradas"
        padding={false}
      >
        <div className="overflow-x-auto">
          <table className="app-table min-w-[780px]">
            <thead>
              <tr>
                <th>Tema</th>
                <th>Matéria</th>
                <th>Questões</th>
                <th>Respostas</th>
                <th>Acerto</th>
                <th>Prioridade</th>
              </tr>
            </thead>
            <tbody>
              {topicRows.map((row) => {
                const priority =
                  row.answered === 0
                    ? "Sem dados"
                    : row.accuracy < 50
                      ? "Alta"
                      : row.accuracy < 70
                        ? "Média"
                        : "Baixa";
                return (
                  <tr key={row.key}>
                    <td className="font-bold text-white">
                      {row.key.split(":").slice(1).join(":")}
                    </td>
                    <td>
                      <Badge>
                        <i
                          className="h-2 w-2 rounded-full"
                          style={{ background: row.color }}
                        />
                        {row.subject}
                      </Badge>
                    </td>
                    <td>{row.questions}</td>
                    <td>{row.answered}</td>
                    <td className="font-black">
                      {row.answered ? `${formatScore(row.accuracy)}%` : "—"}
                    </td>
                    <td>
                      <Badge
                        tone={
                          priority === "Alta"
                            ? "danger"
                            : priority === "Média"
                              ? "warning"
                              : priority === "Baixa"
                                ? "success"
                                : "neutral"
                        }
                      >
                        {priority}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {!topicRows.length ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon="chart"
                      title="Sem respostas suficientes"
                      description="A matriz será preenchida quando os alunos responderem questões."
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ExportCard
          title="Relatório por aluno"
          description="Perfis, turmas e status."
          href="/api/admin/exports/students"
        />
        <ExportCard
          title="Relatório por simulado"
          description="Status, participação e médias."
          href={`/api/admin/exports/reports${exportQuery ? `?${exportQuery}` : ""}`}
        />
        <ExportCard
          title="Ranking"
          description="Todas as posições e respostas filtradas."
          href={`/api/admin/exports/rankings${exportQuery ? `?${exportQuery}&mode=all&sort=correct` : "?mode=all&sort=correct"}`}
        />
      </div>
    </>
  );
}

function Filter({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="app-label">{label}</label>
      <select name={name} defaultValue={value} className="app-input">
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ExportCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Card>
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#3a3a3a] bg-[#222]">
        <Icon name="download" className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-bold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#777]">{description}</p>
      <a href={href} className="app-button-secondary mt-5 w-full">
        <Icon name="download" className="h-4 w-4" /> Gerar CSV
      </a>
    </Card>
  );
}

function clean(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}
