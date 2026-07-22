import Link from "next/link";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { Icon } from "@/components/icon";
import {
  getClasses,
  getQuizzes,
  getRankings,
  getSubjects,
} from "@/server/data/admin";
import { formatDate, formatDuration, formatScore } from "@/lib/format";
import type { RankingFilters } from "@/lib/domain-types";

type SearchParams = {
  classId?: string;
  quizId?: string;
  subjectId?: string;
  sort?: string;
  mode?: string;
};

const validSorts = new Set<NonNullable<RankingFilters["sort"]>>([
  "score",
  "correct",
  "accuracy",
  "time",
  "recent",
]);
const validModes = new Set<NonNullable<RankingFilters["mode"]>>([
  "best",
  "all",
]);

export default async function AdminRankingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filters: RankingFilters = {
    classId: clean(params.classId),
    quizId: clean(params.quizId),
    subjectId: clean(params.subjectId),
    sort: validSorts.has(params.sort as NonNullable<RankingFilters["sort"]>)
      ? (params.sort as RankingFilters["sort"])
      : "correct",
    mode: validModes.has(params.mode as NonNullable<RankingFilters["mode"]>)
      ? (params.mode as RankingFilters["mode"])
      : "best",
  };
  const [ranking, classes, quizzes, subjects] = await Promise.all([
    getRankings(filters),
    getClasses(),
    getQuizzes(),
    getSubjects(),
  ]);
  const scores = ranking.map((item) => item.score);
  const average = scores.length
    ? scores.reduce((sum, value) => sum + value, 0) / scores.length
    : 0;
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value)) as string[][],
  ).toString();

  return (
    <>
      <PageHeader
        eyebrow="Engajamento"
        title="Rankings"
        description="Filtre por turma, simulado e matéria, mantendo somente o apelido na classificação pública."
        actions={
          <a
            href={`/api/admin/exports/rankings${exportQuery ? `?${exportQuery}` : ""}`}
            className="app-button-secondary"
          >
            <Icon name="download" className="h-4 w-4" /> Exportar ranking
          </a>
        }
      />

      <form
        method="get"
        className="app-card mb-6 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-6"
      >
        <Filter
          label="Turma"
          name="classId"
          value={filters.classId || ""}
          options={classes.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <Filter
          label="Simulado"
          name="quizId"
          value={filters.quizId || ""}
          options={quizzes.map((item) => ({
            value: item.id,
            label: item.title,
          }))}
        />
        <Filter
          label="Matéria"
          name="subjectId"
          value={filters.subjectId || ""}
          options={subjects.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <Filter
          label="Ordenar por"
          name="sort"
          value={filters.sort || "correct"}
          includeAll={false}
          options={[
            { value: "correct", label: "Maior pontuação" },
            { value: "correct", label: "Mais acertos" },
            { value: "accuracy", label: "Maior precisão" },
            { value: "time", label: "Menor tempo" },
            { value: "recent", label: "Mais recente" },
          ]}
        />
        <Filter
          label="Tentativas"
          name="mode"
          value={filters.mode || "best"}
          includeAll={false}
          options={[
            { value: "best", label: "Melhor por aluno" },
            { value: "all", label: "Todas as respostas" },
          ]}
        />
        <div className="flex items-end gap-2">
          <button className="app-button-primary flex-1">
            <Icon name="filter" className="h-4 w-4" /> Aplicar
          </button>
          <Link
            href="/admin/rankings"
            className="app-button-secondary px-3"
            aria-label="Limpar filtros"
          >
            <Icon name="refresh" className="h-4 w-4" />
          </Link>
        </div>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Alunos"
          value={new Set(ranking.map((item) => item.studentId)).size}
          icon="users"
          tone="primary"
        />
        <StatCard
          label="Respostas exibidas"
          value={ranking.length}
          icon="clipboard"
          tone="neutral"
        />
        <StatCard
          label="Média"
          value={formatScore(average)}
          icon="target"
          tone="success"
        />
        <StatCard
          label="Pontuação líder"
          value={formatScore(scores.length ? Math.max(...scores) : 0)}
          icon="trophy"
          tone="warning"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_.65fr]">
        <Card
          title="Classificação"
          description={
            filters.mode === "all"
              ? "Todas as tentativas submetidas"
              : "Melhor tentativa de cada aluno por escopo"
          }
          padding={false}
        >
          {ranking.length ? (
            <div className="overflow-x-auto">
              <table className="app-table min-w-[1240px]">
                <thead>
                  <tr>
                    <th>Posição</th>
                    <th>Apelido</th>
                    <th>Turma / simulado</th>
                    <th>Pontuação</th>
                    <th>Acertos</th>
                    <th>Erros</th>
                    <th>Precisão</th>
                    <th>Tempo</th>
                    <th>Envio</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 font-black ${item.position <= 3 ? "bg-amber-500/15 text-amber-300" : "bg-[#242424] text-[#bbb]"}`}
                        >
                          {item.position}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={item.nickname} size="sm" />
                          <div>
                            <p className="font-semibold text-white">
                              @{item.nickname}
                            </p>
                            <Badge className="mt-1">
                              <i
                                className="h-2 w-2 rounded-full"
                                style={{ background: item.subjectColor }}
                              />
                              {item.subject}
                            </Badge>
                          </div>
                        </div>
                      </td>
                      <td>
                        <p className="text-sm font-bold text-white">
                          {item.quiz}
                        </p>
                        <p className="mt-1 text-xs text-[#777]">
                          {item.className}
                        </p>
                      </td>
                      <td className="text-base font-black text-white">
                        {formatScore(item.score)}
                      </td>
                      <td className="font-bold text-emerald-300">
                        {item.correct}
                      </td>
                      <td className="font-bold text-rose-300">{item.wrong}</td>
                      <td>{formatScore(item.accuracy)}%</td>
                      <td>{formatDuration(item.durationSeconds)}</td>
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
              icon="trophy"
              title="Nenhuma resposta encontrada"
              description="Ajuste os filtros ou aguarde os alunos concluírem os simulados."
            />
          )}
        </Card>
        <aside className="space-y-6">
          <Card title="Critérios">
            <ol className="space-y-4 text-sm text-[#999]">
              <li>
                <b className="text-white">Pontuação</b>
                <p className="mt-1">Nota normalizada da tentativa.</p>
              </li>
              <li>
                <b className="text-white">Acertos</b>
                <p className="mt-1">Pode ser usado como ordenação principal.</p>
              </li>
              <li>
                <b className="text-white">Tempo</b>
                <p className="mt-1">Menor duração atua como desempate.</p>
              </li>
            </ol>
          </Card>
          <Card title="Privacidade">
            <div className="flex items-start gap-3">
              <Icon name="shield" className="mt-0.5 h-5 w-5 text-emerald-300" />
              <p className="text-sm leading-6 text-[#888]">
                A tabela mostra apenas o apelido. O botão de detalhes abre a
                área administrativa protegida do aluno.
              </p>
            </div>
            <Badge tone="success" className="mt-4">
              Dados protegidos
            </Badge>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Filter({
  label,
  name,
  value,
  options,
  includeAll = true,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  includeAll?: boolean;
}) {
  return (
    <div>
      <label className="app-label">{label}</label>
      <select name={name} defaultValue={value} className="app-input">
        {includeAll ? <option value="">Todos</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function clean(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}
