"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Alert, Badge, StatusBadge } from "@/components/ui";
import type { QuestionModel, QuizSummary } from "@/lib/domain-types";

type EditableQuestion = {
  id?: string;
  quizId: string;
  subjectId: string;
  statement: string;
  topic: string;
  subtopic: string;
  difficulty: "easy" | "medium" | "hard";
  expected_time_seconds: number;
  options: Array<{ label: "A" | "B" | "C" | "D" | "E"; text: string }>;
  correct_label: "A" | "B" | "C" | "D" | "E";
  explanation_correct: string;
  explanation_wrong: string;
};

const labels = ["A", "B", "C", "D", "E"] as const;

function toEditable(question: QuestionModel): EditableQuestion {
  return {
    id: question.id,
    quizId: question.quizId,
    subjectId: question.subjectId,
    statement: question.statement,
    topic: question.topic,
    subtopic: question.subtopic,
    difficulty: question.difficulty,
    expected_time_seconds: question.expectedTimeSeconds,
    options: labels.map((label) => ({
      label,
      text:
        question.options.find((option) => option.label === label)?.text || "",
    })),
    correct_label: question.correctLabel,
    explanation_correct: question.explanationCorrect,
    explanation_wrong: question.explanationWrong,
  };
}

function blankQuestion(quizId: string, subjectId: string): EditableQuestion {
  return {
    quizId,
    subjectId,
    statement: "",
    topic: "",
    subtopic: "",
    difficulty: "medium",
    expected_time_seconds: 120,
    options: labels.map((label) => ({ label, text: "" })),
    correct_label: "A",
    explanation_correct: "",
    explanation_wrong: "",
  };
}

export function QuestionBankManager({
  initialQuestions,
  quizzes,
}: {
  initialQuestions: QuestionModel[];
  quizzes: QuizSummary[];
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetQuizId, setTargetQuizId] = useState("");
  const [editing, setEditing] = useState<EditableQuestion | null>(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);

  const editableQuizzes = quizzes.filter(
    (quiz) =>
      ["draft", "review"].includes(quiz.status) ||
      (quiz.status === "published" && quiz.attempts === 0),
  );
  const subjects = [...new Set(questions.map((item) => item.subject))].sort();
  const filtered = useMemo(
    () =>
      questions.filter((item) => {
        const term = search.toLowerCase();
        return (
          (!term ||
            `${item.statement} ${item.topic} ${item.subtopic} ${item.quizTitle}`
              .toLowerCase()
              .includes(term)) &&
          (!subject || item.subject === subject) &&
          (!status || item.reviewStatus === status)
        );
      }),
    [questions, search, subject, status],
  );

  function toggle(id: string) {
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  }

  async function review(
    question: QuestionModel,
    nextStatus: "approved" | "rejected" | "review",
  ) {
    if (
      nextStatus === "rejected" &&
      !confirm("Marcar esta questão como rejeitada? Ela será removida ao concluir um lote de IA ou poderá ser excluída manualmente.")
    )
      return;
    setBusyId(question.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/questions/${question.id}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error?.message || "Falha na revisão.");
      if (payload?.data?.deleted) {
        setQuestions((items) =>
          items.filter((item) => item.id !== question.id),
        );
        setSelected((items) => items.filter((item) => item !== question.id));
      } else {
        setQuestions((items) =>
          items.map((item) =>
            item.id === question.id
              ? { ...item, reviewStatus: nextStatus }
              : item,
          ),
        );
      }
      setMessage({
        tone: "success",
        text:
          nextStatus === "approved"
            ? "Questão aprovada e disponível para reutilização."
            : nextStatus === "rejected"
              ? "Questão marcada como rejeitada."
              : "Questão devolvida para revisão.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Erro na revisão.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function regenerate(question: QuestionModel) {
    const instruction = prompt(
      "Orientação opcional para a regeneração:",
      `Crie uma versão diferente sobre ${question.topic}.`,
    );
    if (instruction === null) return;
    setBusyId(question.id);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/questions/${question.id}/regenerate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error?.message || "Falha ao regenerar.");
      const refreshed = await loadQuestion(question.id, question);
      setQuestions((items) =>
        items.map((item) => (item.id === question.id ? refreshed : item)),
      );
      setMessage({
        tone: "success",
        text: `Questão regenerada. Tokens: ${payload.data.inputTokens || 0} entrada / ${payload.data.outputTokens || 0} saída.`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Falha ao regenerar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function loadQuestion(
    id: string,
    base: QuestionModel,
  ): Promise<QuestionModel> {
    const response = await fetch(`/api/admin/questions/${id}`);
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload?.error?.message || "Não foi possível atualizar a questão.",
      );
    const data = payload.data;
    const correct = data.options.find(
      (option: any) => option.id === data.key?.correct_option_id,
    );
    return {
      ...base,
      statement: data.question.statement,
      topic: data.question.topic || "Sem tema",
      subtopic: data.question.subtopic || "Sem subtema",
      difficulty: data.question.difficulty,
      expectedTimeSeconds: Number(data.question.expected_time_seconds || 120),
      reviewStatus: data.question.review_status || "review",
      options: data.options.map((option: any) => ({
        id: option.id,
        label: option.label,
        text: option.option_text,
      })),
      correctOptionId: data.key?.correct_option_id || "",
      correctLabel: correct?.label || "A",
      explanationCorrect: data.key?.explanation_correct || "",
      explanationWrong: data.key?.explanation_wrong || "",
    };
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusyId(editing.id || "new");
    setMessage(null);
    try {
      const body = {
        statement: editing.statement,
        topic: editing.topic,
        subtopic: editing.subtopic,
        difficulty: editing.difficulty,
        expected_time_seconds: editing.expected_time_seconds,
        options: editing.options,
        correct_label: editing.correct_label,
        explanation_correct: editing.explanation_correct,
        explanation_wrong: editing.explanation_wrong,
      };
      const response = await fetch(
        editing.id
          ? `/api/admin/questions/${editing.id}`
          : "/api/admin/questions",
        {
          method: editing.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            editing.id ? body : { ...body, quizId: editing.quizId, subjectId: editing.subjectId },
          ),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error?.message || "Não foi possível salvar.");
      if (editing.id) {
        const base = questions.find((item) => item.id === editing.id)!;
        const refreshed = await loadQuestion(editing.id, base);
        setQuestions((items) =>
          items.map((item) => (item.id === editing.id ? refreshed : item)),
        );
      } else {
        window.location.reload();
        return;
      }
      setEditing(null);
      setMessage({
        tone: "success",
        text: "Questão salva e devolvida para revisão.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Erro ao salvar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function attachSelected() {
    const approved = questions
      .filter(
        (item) =>
          selected.includes(item.id) && item.reviewStatus === "approved",
      )
      .map((item) => item.id);
    if (!targetQuizId)
      return setMessage({
        tone: "warning",
        text: "Selecione o simulado de destino.",
      });
    if (!approved.length)
      return setMessage({
        tone: "warning",
        text: "Selecione ao menos uma questão aprovada.",
      });
    setBusyId("attach");
    try {
      const response = await fetch("/api/admin/questions/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetQuizId, questionIds: approved }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload?.error?.message || "Não foi possível reutilizar as questões.",
        );
      setSelected([]);
      setMessage({
        tone: payload.data.skipped ? "warning" : "success",
        text: `${payload.data.copied} questão(ões) adicionada(s) ao simulado.${payload.data.skipped ? ` ${payload.data.skipped} já existia(m) e foi(ram) ignorada(s).` : ""}`,
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "Erro ao adicionar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(question: QuestionModel) {
    if (!confirm("Excluir esta questão do rascunho?")) return;
    const response = await fetch(`/api/admin/questions/${question.id}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      return setMessage({
        tone: "danger",
        text: payload?.error?.message || "Não foi possível excluir.",
      });
    setQuestions((items) => items.filter((item) => item.id !== question.id));
    setMessage({ tone: "success", text: "Questão excluída." });
  }

  return (
    <div className="space-y-5">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="app-card grid gap-3 p-4 lg:grid-cols-[1fr_.35fr_.3fr_auto]">
        <div className="relative">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          />
          <input
            className="app-input pl-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar enunciado, tema ou simulado"
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
          <option value="review">Em revisão</option>
          <option value="approved">Aprovadas</option>
        </select>
        <button
          className="app-button-primary"
          disabled={!editableQuizzes.length}
          onClick={() =>
            setEditing(blankQuestion(editableQuizzes[0]?.id || "", editableQuizzes[0]?.subjectIds[0] || ""))
          }
        >
          <Icon name="plus" className="h-4 w-4" /> Nova questão
        </button>
      </div>

      <div className="app-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Reutilizar questões aprovadas
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Cada questão aparece uma única vez no banco. Ao reutilizar, o
            sistema cria uma cópia histórica sem exibi-la como duplicação.
          </p>
        </div>
        <select
          className="app-input lg:max-w-sm"
          value={targetQuizId}
          onChange={(event) => setTargetQuizId(event.target.value)}
        >
          <option value="">Selecione o simulado de destino</option>
          {editableQuizzes.map((quiz) => (
            <option key={quiz.id} value={quiz.id}>
              {quiz.title} · {quiz.subject}
            </option>
          ))}
        </select>
        <button
          className="app-button-primary"
          onClick={attachSelected}
          disabled={busyId === "attach" || !selected.length}
        >
          <Icon
            name={busyId === "attach" ? "refresh" : "copy"}
            className={`h-4 w-4 ${busyId === "attach" ? "animate-spin" : ""}`}
          />{" "}
          Adicionar selecionadas ({selected.length})
        </button>
        <a className="app-button-secondary" href="/api/admin/exports/questions">
          <Icon name="download" className="h-4 w-4" /> Exportar
        </a>
      </div>

      <div className="space-y-4">
        {filtered.map((question, index) => (
          <article key={question.id} className="app-card overflow-hidden">
            <div
              className="h-1"
              style={{ background: question.subjectColor }}
            />
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(question.id)}
                    onChange={() => toggle(question.id)}
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>#{index + 1}</Badge>
                      <Badge className="text-slate-900">{question.subject}</Badge>
                      <Badge>{question.topic}</Badge>
                      <Badge
                        tone={
                          question.difficulty === "easy"
                            ? "success"
                            : question.difficulty === "hard"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {question.difficulty}
                      </Badge>
                      <StatusBadge status={question.reviewStatus} />
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {question.quizTitle} ·{" "}
                      {Math.round(question.expectedTimeSeconds / 60)} min
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-5 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-900">
                {question.statement}
              </p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {question.options.map((option) => (
                  <div
                    key={option.id}
                    className={`flex gap-3 rounded-lg border p-3 text-sm ${option.label === question.correctLabel ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
                  >
                    <b>{option.label}</b>
                    <span>{option.text}</span>
                  </div>
                ))}
              </div>
              {question.explanationCorrect ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                  <b className="text-slate-900">Justificativa:</b>{" "}
                  {question.explanationCorrect}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  className="app-button-secondary"
                  onClick={() => regenerate(question)}
                  disabled={busyId === question.id || !question.sourceAiJobId}
                >
                  <Icon
                    name="refresh"
                    className={`h-4 w-4 ${busyId === question.id ? "animate-spin" : ""}`}
                  />{" "}
                  Regenerar
                </button>
                <button
                  className="app-button-secondary"
                  onClick={() => setEditing(toEditable(question))}
                >
                  <Icon name="edit" className="h-4 w-4" /> Editar
                </button>
                {question.reviewStatus !== "approved" ? (
                  <button
                    className="app-button-primary"
                    onClick={() => review(question, "approved")}
                    disabled={busyId === question.id}
                  >
                    <Icon name="check" className="h-4 w-4" /> Aprovar
                  </button>
                ) : (
                  <button
                    className="app-button-secondary"
                    onClick={() => review(question, "review")}
                  >
                    <Icon name="refresh" className="h-4 w-4" /> Reabrir
                  </button>
                )}
                <button
                  className="app-button-danger"
                  onClick={() => review(question, "rejected")}
                >
                  <Icon name="x" className="h-4 w-4" /> Rejeitar
                </button>
                <button
                  className="app-button-danger px-3"
                  onClick={() => remove(question)}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length ? (
        <div className="app-card p-12 text-center text-sm text-slate-500">
          Nenhuma questão encontrada com estes filtros.
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={saveQuestion}
            className="mx-auto my-6 max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {editing.id ? "Editar questão" : "Nova questão"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  A edição salva no banco e exige nova aprovação.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-orange-50 hover:text-orange-600"
                onClick={() => setEditing(null)}
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {!editing.id ? (
              <div className="mt-5">
                <label className="app-label">Simulado de destino</label>
                <select
                  required
                  className="app-input"
                  value={editing.quizId}
                  onChange={(event) => {
                    const quiz = editableQuizzes.find((item) => item.id === event.target.value);
                    setEditing({ ...editing, quizId: event.target.value, subjectId: quiz?.subjectIds[0] || '' });
                  }}
                >
                  {editableQuizzes.map((quiz) => (
                    <option key={quiz.id} value={quiz.id}>
                      {quiz.title} · {quiz.subject}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {!editing.id ? <div className="mt-5"><label className="app-label">Matéria da questão</label><select required className="app-input" value={editing.subjectId} onChange={(event) => setEditing({ ...editing, subjectId: event.target.value })}>{(editableQuizzes.find((item) => item.id === editing.quizId)?.subjectIds || []).map((id, index) => <option key={id} value={id}>{editableQuizzes.find((item) => item.id === editing.quizId)?.subjectNames[index] || 'Matéria'}</option>)}</select></div> : null}
            <div className="mt-5">
              <label className="app-label">Enunciado</label>
              <textarea
                required
                minLength={10}
                className="app-input min-h-32"
                value={editing.statement}
                onChange={(event) =>
                  setEditing({ ...editing, statement: event.target.value })
                }
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="app-label">Tema</label>
                <input
                  required
                  minLength={2}
                  className="app-input"
                  value={editing.topic}
                  onChange={(event) =>
                    setEditing({ ...editing, topic: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="app-label">Subtema</label>
                <input
                  required
                  minLength={2}
                  className="app-input"
                  value={editing.subtopic}
                  onChange={(event) =>
                    setEditing({ ...editing, subtopic: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="app-label">Dificuldade</label>
                <select
                  className="app-input"
                  value={editing.difficulty}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      difficulty: event.target
                        .value as EditableQuestion["difficulty"],
                    })
                  }
                >
                  <option value="easy">Fácil</option>
                  <option value="medium">Média</option>
                  <option value="hard">Difícil</option>
                </select>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {editing.options.map((option, index) => (
                <div
                  key={option.label}
                  className="grid grid-cols-[44px_1fr_auto] gap-3"
                >
                  <span className="flex items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-900">
                    {option.label}
                  </span>
                  <input
                    required
                    className="app-input"
                    value={option.text}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        options: editing.options.map((item, optionIndex) =>
                          optionIndex === index
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <label className="flex items-center gap-2 px-2 text-xs text-slate-500">
                    <input
                      type="radio"
                      name="correct"
                      checked={editing.correct_label === option.label}
                      onChange={() =>
                        setEditing({ ...editing, correct_label: option.label })
                      }
                      className="accent-orange-500"
                    />{" "}
                    correta
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="app-label">
                  Explicação da alternativa correta
                </label>
                <textarea
                  required
                  minLength={10}
                  className="app-input min-h-24"
                  value={editing.explanation_correct}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      explanation_correct: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="app-label">
                  Explicação para as incorretas
                </label>
                <textarea
                  required
                  minLength={10}
                  className="app-input min-h-24"
                  value={editing.explanation_wrong}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      explanation_wrong: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="app-button-secondary"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </button>
              <button
                className="app-button-primary"
                disabled={busyId === (editing.id || "new")}
              >
                <Icon name="save" className="h-4 w-4" /> Salvar questão
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
