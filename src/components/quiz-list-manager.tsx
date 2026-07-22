"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Alert, Badge, ProgressBar, StatusBadge } from "@/components/ui";
import type { QuizSummary } from "@/lib/domain-types";
import { formatDate } from "@/lib/format";

export function QuizListManager({
  initialQuizzes,
}: {
  initialQuizzes: QuizSummary[];
}) {
  const [quizzes, setQuizzes] = useState(initialQuizzes);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const subjects = [...new Set(quizzes.map((item) => item.subject))].sort();
  const filtered = useMemo(
    () =>
      quizzes.filter((item) => {
        const term = search.toLowerCase();
        return (
          (!term ||
            `${item.title} ${item.description || ""} ${item.className}`
              .toLowerCase()
              .includes(term)) &&
          (!status || item.status === status) &&
          (!subject || item.subject === subject)
        );
      }),
    [quizzes, search, status, subject],
  );

  async function updateStatus(
    quiz: QuizSummary,
    nextStatus: "published" | "review" | "draft",
  ) {
    setBusy(quiz.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          payload?.error?.message || "Não foi possível atualizar.",
        );
      setQuizzes((items) =>
        items.map((item) =>
          item.id === quiz.id ? { ...item, status: nextStatus } : item,
        ),
      );
      setMessage({
        tone: "success",
        text:
          nextStatus === "published"
            ? "Simulado publicado."
            : "Status atualizado.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Falha ao atualizar.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(quiz: QuizSummary) {
    const warning =
      quiz.attempts > 0
        ? `Excluir definitivamente “${quiz.title}”? As ${quiz.attempts} tentativa(s), respostas, questões e rankings vinculados também serão apagados.`
        : `Excluir definitivamente “${quiz.title}”? Questões e atribuições vinculadas também serão apagadas.`;
    if (!confirm(warning)) return;
    setBusy(quiz.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/quizzes/${quiz.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          payload?.error?.message || "Não foi possível excluir o simulado.",
        );
      setQuizzes((items) => items.filter((item) => item.id !== quiz.id));
      setMessage({
        tone: "success",
        text: "Simulado excluído definitivamente.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Falha ao excluir.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="app-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_210px_190px_auto]">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              className="app-input pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar simulado, descrição ou turma"
            />
          </div>
          <select
            className="app-input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          >
            <option value="">Todas as matérias</option>
            {subjects.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            className="app-input"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Todos os status</option>
            <option value="published">Publicado</option>
            <option value="review">Em revisão</option>
            <option value="draft">Rascunho</option>
          </select>
          <a className="app-button-secondary" href="/api/admin/exports/quizzes">
            <Icon name="download" className="h-4 w-4" /> Exportar
          </a>
        </div>
      </div>
      <div className="app-table-wrap">
        <table className="app-table min-w-[1180px]">
          <thead>
            <tr>
              <th>Simulado</th>
              <th>Matéria</th>
              <th>Turma</th>
              <th>Questões</th>
              <th>Status</th>
              <th>Participação</th>
              <th>Prazo</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((quiz) => (
              <tr key={quiz.id}>
                <td>
                  <Link
                    href={`/admin/simulados/${quiz.id}`}
                    className="font-semibold text-slate-900 hover:underline"
                  >
                    {quiz.title}
                  </Link>
                  <p className="mt-1 max-w-xs truncate text-xs text-slate-400">
                    {quiz.description || "Sem descrição"}
                  </p>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <i
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: quiz.subjectColor }}
                    />
                    <Badge>{quiz.subject}</Badge>
                  </span>
                </td>
                <td>{quiz.className}</td>
                <td>{quiz.questionCount}</td>
                <td>
                  <StatusBadge status={quiz.status} />
                </td>
                <td>
                  <div className="w-28">
                    <ProgressBar
                      value={quiz.participation}
                      color={quiz.subjectColor}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      {quiz.participation}% · {quiz.attempts} tentativas
                    </p>
                  </div>
                </td>
                <td>{quiz.dueAt ? formatDate(quiz.dueAt) : "—"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/admin/simulados/${quiz.id}`}
                      className="app-button-secondary px-3 py-2"
                      title={quiz.canEdit ? "Editar configurações" : "Visualizar detalhes"}
                    >
                      <Icon name={quiz.canEdit ? "edit" : "eye"} className="h-4 w-4" />
                    </Link>
                    <Link
                      href={`/admin/simulados/${quiz.id}/questoes`}
                      className="app-button-secondary px-3 py-2"
                      title="Editar questões"
                    >
                      <Icon name="clipboard" className="h-4 w-4" />
                    </Link>
                    {quiz.canEdit && quiz.status !== "published" ? (
                      <button
                        onClick={() => updateStatus(quiz, "published")}
                        disabled={busy === quiz.id}
                        className="app-button-primary px-3 py-2"
                      >
                        <Icon name="check" className="h-4 w-4" /> Publicar
                      </button>
                    ) : quiz.canEdit && quiz.attempts === 0 ? (
                      <button
                        onClick={() => updateStatus(quiz, "review")}
                        disabled={busy === quiz.id}
                        className="app-button-secondary px-3 py-2"
                      >
                        Reabrir
                      </button>
                    ) : null}
                    {quiz.canDelete ? (
                      <button
                        onClick={() => remove(quiz)}
                        disabled={busy === quiz.id}
                        className="app-button-danger px-3 py-2"
                        title="Excluir definitivamente"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length ? (
        <div className="app-card p-12 text-center text-sm text-slate-500">
          Nenhum simulado encontrado.
        </div>
      ) : null}
    </div>
  );
}
