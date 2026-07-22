import { z } from "zod";
import { authorizeManagement } from "@/server/auth/management";
import { jsonError } from "@/lib/http";
import { appSchema } from "@/server/supabase/admin";
import { auditLog } from "@/server/audit/audit";
import { getRankings } from "@/server/data/admin";
import type { RankingFilters } from "@/lib/domain-types";

const paramsSchema = z.object({
  type: z.enum([
    "students",
    "classes",
    "subjects",
    "quizzes",
    "questions",
    "reports",
    "rankings",
    "audit",
    "ai",
  ]),
});
type Row = Record<string, unknown>;

export async function GET(
  request: Request,
  context: { params: Promise<{ type: string }> },
) {
  const auth = await authorizeManagement(request, [
    "admin",
    "coordinator",
    "teacher",
  ]);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return jsonError("BAD_REQUEST", "Tipo de exportação inválido.", 400);
  const organizationId = auth.membership.organizationId;
  const teacherAllowedExports = new Set(["quizzes", "questions", "reports", "rankings", "ai"]);
  if (auth.scope.role === "teacher" && !teacherAllowedExports.has(params.data.type)) {
    return jsonError("FORBIDDEN", "Esta exportação é restrita à coordenação e aos administradores.", 403);
  }
  const subjectScope = auth.scope.role === "teacher" ? auth.scope.allowedSubjectIds : null;
  const filters = rankingFiltersFromUrl(new URL(request.url));
  let exportRows: Row[] = [];
  let fileLabel: string = params.data.type;

  try {
    switch (params.data.type) {
      case "students":
        exportRows = await exportStudents(organizationId, subjectScope);
        fileLabel = "alunos";
        break;
      case "classes":
        exportRows = await exportClasses(organizationId, subjectScope);
        fileLabel = "turmas";
        break;
      case "subjects":
        exportRows = await exportSubjects(organizationId, subjectScope);
        fileLabel = "materias";
        break;
      case "quizzes":
        exportRows = await exportQuizzes(organizationId, subjectScope);
        fileLabel = "simulados";
        break;
      case "questions":
        exportRows = await exportQuestions(organizationId, subjectScope);
        fileLabel = "questoes";
        break;
      case "reports":
        exportRows = await exportFilteredResponses({
          ...filters,
          mode: "all",
          sort: "correct",
        });
        fileLabel = "relatorio-pedagogico";
        break;
      case "rankings":
        exportRows = await exportFilteredResponses(filters);
        fileLabel = "ranking";
        break;
      case "audit":
        if (auth.scope.role === "teacher") {
          return jsonError("FORBIDDEN", "Professores não podem exportar a auditoria da organização.", 403);
        }
        exportRows = await exportTable(
          "audit_logs",
          organizationId,
          "created_at,actor_auth_uid,action,entity_name,entity_id,ip_address,metadata",
        );
        fileLabel = "auditoria";
        break;
      case "ai":
        exportRows = await exportAiJobs(organizationId, subjectScope);
        fileLabel = "geracoes-ia";
        break;
    }
  } catch (error) {
    return jsonError(
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "Erro ao gerar exportação.",
      500,
    );
  }

  await auditLog({
    organizationId,
    actorAuthUid: auth.user.authUid,
    action: "data_exported",
    entityName: params.data.type,
    metadata: { rows: exportRows.length, format: "csv" },
  });
  const csv = toCsv(exportRows);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nexo-${fileLabel}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}

async function exportTable(
  table: string,
  organizationId: string,
  select: string,
  orderColumn = "created_at",
  excludeArchived = false,
): Promise<Row[]> {
  let query = appSchema()
    .from(table)
    .select(select)
    .eq("organization_id", organizationId);
  if (excludeArchived) query = query.neq("status", "archived");
  const { data, error } = await query.order(orderColumn, { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

async function exportClasses(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  if (subjectScope === null) {
    return exportTable(
      "classes",
      organizationId,
      "id,code,name,description,status,created_at",
      "created_at",
      true,
    );
  }
  if (!subjectScope.length) return [];
  const { data: enrollments, error: enrollmentError } = await appSchema()
    .from("enrollments")
    .select("class_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("subject_id", subjectScope);
  if (enrollmentError) throw new Error(enrollmentError.message);
  const classIds = [...new Set((enrollments ?? []).map((item) => item.class_id))];
  if (!classIds.length) return [];
  const { data, error } = await appSchema()
    .from("classes")
    .select("id,code,name,description,status,created_at")
    .eq("organization_id", organizationId)
    .neq("status", "archived")
    .in("id", classIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

async function exportSubjects(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  let query = appSchema()
    .from("subjects")
    .select("id,code,name,color,status,created_at")
    .eq("organization_id", organizationId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (subjectScope !== null) {
    if (!subjectScope.length) return [];
    query = query.in("id", subjectScope);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

async function exportStudents(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  const [
    { data: profiles, error },
    { data: enrollments, error: enrollmentError },
    { data: classes, error: classError },
    { data: subjects, error: subjectError },
  ] = await Promise.all([
    appSchema()
      .from("student_profiles")
      .select("id,full_name,nickname,email,cpf_last4,status,created_at")
      .eq("organization_id", organizationId)
      .order("full_name"),
    appSchema()
      .from("enrollments")
      .select("student_id,class_id,subject_id,status,contract_status")
      .eq("organization_id", organizationId),
    appSchema()
      .from("classes")
      .select("id,name")
      .eq("organization_id", organizationId),
    appSchema()
      .from("subjects")
      .select("id,name")
      .eq("organization_id", organizationId),
  ]);
  if (error || enrollmentError || classError || subjectError) {
    throw new Error(
      error?.message ||
        enrollmentError?.message ||
        classError?.message ||
        subjectError?.message ||
        "Falha ao carregar alunos.",
    );
  }
  const classMap = new Map((classes ?? []).map((item) => [item.id, item.name]));
  const subjectMap = new Map(
    (subjects ?? []).map((item) => [item.id, item.name]),
  );
  const activeLinks = (enrollments ?? []).filter(
    (item) =>
      item.status === "active" &&
      item.contract_status !== "pending" &&
      (subjectScope === null || subjectScope.includes(item.subject_id)),
  );
  const visibleStudentIds = new Set(activeLinks.map((item) => item.student_id));
  return (profiles ?? [])
    .filter(
      (profile) =>
        subjectScope === null || visibleStudentIds.has(profile.id),
    )
    .map((profile) => {
      const links = activeLinks.filter((item) => item.student_id === profile.id);
      return {
        nome: profile.full_name,
        apelido: profile.nickname,
        email: profile.email,
        cpf_protegido: `***.***.***-${String(profile.cpf_last4 || "").slice(-2)}`,
        turmas: [
          ...new Set(
            links.map((item) => classMap.get(item.class_id)).filter(Boolean),
          ),
        ].join(" | "),
        materias: [
          ...new Set(
            links
              .map((item) => subjectMap.get(item.subject_id))
              .filter(Boolean),
          ),
        ].join(" | "),
        status: profile.status,
        cadastrado_em: profile.created_at,
      };
    });
}

async function exportQuizzes(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  const [
    { data: quizzes, error },
    { data: subjects, error: subjectError },
    { data: classes, error: classError },
    { data: questions, error: questionError },
    { data: quizSubjects, error: quizSubjectError },
    { data: quizClasses, error: quizClassError },
    { data: attempts, error: attemptError },
  ] = await Promise.all([
    appSchema()
      .from("quizzes")
      .select(
        "id,subject_id,title,description,status,quiz_kind,duration_minutes,release_at,due_at,created_at,published_at",
      )
      .eq("organization_id", organizationId)
      .eq("quiz_kind", "assessment")
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    appSchema()
      .from("subjects")
      .select("id,name")
      .eq("organization_id", organizationId),
    appSchema()
      .from("classes")
      .select("id,name")
      .eq("organization_id", organizationId),
    appSchema()
      .from("quiz_questions")
      .select("id,quiz_id,subject_id,review_status"),
    appSchema()
      .from("quiz_subjects")
      .select("quiz_id,subject_id,status")
      .eq("organization_id", organizationId),
    appSchema()
      .from("quiz_classes")
      .select("quiz_id,class_id,status")
      .eq("organization_id", organizationId),
    appSchema()
      .from("attempts")
      .select("id,quiz_id,status,score_normalized")
      .eq("organization_id", organizationId),
  ]);
  const firstError =
    error ||
    subjectError ||
    classError ||
    questionError ||
    quizSubjectError ||
    quizClassError ||
    attemptError;
  if (firstError) throw new Error(firstError.message);

  const subjectMap = new Map(
    (subjects ?? []).map((item) => [item.id, item.name]),
  );
  const classMap = new Map((classes ?? []).map((item) => [item.id, item.name]));
  const visibleQuizzes = (quizzes ?? []).filter((quiz) => {
    if (subjectScope === null) return true;
    const ids = (quizSubjects ?? [])
      .filter((item) => item.quiz_id === quiz.id && item.status === "active")
      .map((item) => item.subject_id);
    if (!ids.length) ids.push(quiz.subject_id);
    return ids.some((id) => subjectScope.includes(id));
  });

  const submittedAttemptIds = (attempts ?? [])
    .filter((item) => item.status === "submitted")
    .map((item) => item.id);
  let answerRows: Array<{
    attempt_id: string;
    quiz_question_id: string;
    is_correct: boolean | null;
  }> = [];
  if (subjectScope !== null && submittedAttemptIds.length) {
    const { data, error: answerError } = await appSchema()
      .from("attempt_answers")
      .select("attempt_id,quiz_question_id,is_correct")
      .in("attempt_id", submittedAttemptIds);
    if (answerError) throw new Error(answerError.message);
    answerRows = data ?? [];
  }

  return visibleQuizzes.map((quiz) => {
    const quizSubjectIds = [
      ...new Set(
        (quizSubjects ?? [])
          .filter((item) => item.quiz_id === quiz.id && item.status === "active")
          .map((item) => item.subject_id),
      ),
    ];
    if (!quizSubjectIds.length) quizSubjectIds.push(quiz.subject_id);
    const visibleSubjectIds =
      subjectScope === null
        ? quizSubjectIds
        : quizSubjectIds.filter((id) => subjectScope.includes(id));
    const classIds = [
      ...new Set(
        (quizClasses ?? [])
          .filter((item) => item.quiz_id === quiz.id && item.status === "active")
          .map((item) => item.class_id),
      ),
    ];
    const visibleQuestions = (questions ?? []).filter(
      (item) =>
        item.quiz_id === quiz.id &&
        item.review_status !== "rejected" &&
        (subjectScope === null || subjectScope.includes(item.subject_id)),
    );
    const visibleQuestionIds = new Set(visibleQuestions.map((item) => item.id));
    const quizAttempts = (attempts ?? []).filter(
      (item) => item.quiz_id === quiz.id && item.status === "submitted",
    );

    let completed = quizAttempts.length;
    let mean: string | number = "";
    if (subjectScope === null) {
      const scores = quizAttempts
        .filter((item) => item.score_normalized !== null)
        .map((item) => Number(item.score_normalized));
      mean = scores.length
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
        : "";
    } else {
      const attemptIdSet = new Set(quizAttempts.map((item) => item.id));
      const scopedAnswers = answerRows.filter(
        (item) =>
          attemptIdSet.has(item.attempt_id) &&
          visibleQuestionIds.has(item.quiz_question_id),
      );
      completed = new Set(scopedAnswers.map((item) => item.attempt_id)).size;
      const correct = scopedAnswers.filter((item) => item.is_correct === true).length;
      mean = scopedAnswers.length
        ? ((correct / scopedAnswers.length) * 100).toFixed(2)
        : "";
    }

    return {
      id: quiz.id,
      titulo: quiz.title,
      materias: visibleSubjectIds
        .map((id) => subjectMap.get(id))
        .filter(Boolean)
        .join(" | "),
      turmas: classIds
        .map((id) => classMap.get(id))
        .filter(Boolean)
        .join(" | "),
      status: quiz.status,
      questoes: visibleQuestions.length,
      duracao_minutos: quiz.duration_minutes,
      tentativas_concluidas: completed,
      media_percentual: mean,
      liberacao: quiz.release_at || "",
      prazo: quiz.due_at || "",
      criado_em: quiz.created_at,
      publicado_em: quiz.published_at || "",
    };
  });
}

async function exportQuestions(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  const [
    { data: quizzes, error },
    { data: subjects, error: subjectError },
    { data: questions, error: questionError },
    { data: options, error: optionError },
    { data: keys, error: keyError },
  ] = await Promise.all([
    appSchema()
      .from("quizzes")
      .select("id,title,subject_id,status,quiz_kind")
      .eq("organization_id", organizationId)
      .neq("status", "archived"),
    appSchema()
      .from("subjects")
      .select("id,name")
      .eq("organization_id", organizationId),
    appSchema()
      .from("quiz_questions")
      .select(
        "id,quiz_id,subject_id,statement,topic,subtopic,difficulty,expected_time_seconds,review_status,position,source_question_id,updated_at",
      ),
    appSchema()
      .from("question_options")
      .select("id,quiz_question_id,label,option_text,position"),
    appSchema()
      .from("question_answer_keys")
      .select(
        "quiz_question_id,correct_option_id,explanation_correct,explanation_wrong",
      ),
  ]);
  const firstError = error || subjectError || questionError || optionError || keyError;
  if (firstError) throw new Error(firstError.message);
  const quizMap = new Map((quizzes ?? []).map((item) => [item.id, item]));
  const subjectMap = new Map(
    (subjects ?? []).map((item) => [item.id, item.name]),
  );
  return (questions ?? [])
    .filter(
      (question) =>
        quizMap.has(question.quiz_id) &&
        !question.source_question_id &&
        question.review_status !== "rejected" &&
        (subjectScope === null || subjectScope.includes(question.subject_id)),
    )
    .map((question) => {
      const quiz = quizMap.get(question.quiz_id)!;
      const questionOptions = (options ?? [])
        .filter((item) => item.quiz_question_id === question.id)
        .sort((a, b) => a.position - b.position);
      const key = (keys ?? []).find(
        (item) => item.quiz_question_id === question.id,
      );
      const correct = questionOptions.find(
        (item) => item.id === key?.correct_option_id,
      );
      return {
        id: question.id,
        origem: quiz.quiz_kind === "question_bank" ? "Banco de questões" : quiz.title,
        materia: subjectMap.get(question.subject_id) || "",
        posicao: question.position,
        tema: question.topic || "",
        subtema: question.subtopic || "",
        dificuldade: question.difficulty,
        status_revisao: question.review_status || "",
        enunciado: question.statement,
        alternativa_a:
          questionOptions.find((item) => item.label === "A")?.option_text || "",
        alternativa_b:
          questionOptions.find((item) => item.label === "B")?.option_text || "",
        alternativa_c:
          questionOptions.find((item) => item.label === "C")?.option_text || "",
        alternativa_d:
          questionOptions.find((item) => item.label === "D")?.option_text || "",
        alternativa_e:
          questionOptions.find((item) => item.label === "E")?.option_text || "",
        gabarito: correct?.label || "",
        explicacao: key?.explanation_correct || "",
        atualizado_em: question.updated_at || "",
      };
    });
}

async function exportAiJobs(
  organizationId: string,
  subjectScope: string[] | null,
): Promise<Row[]> {
  let query = appSchema()
    .from("ai_jobs")
    .select(
      "created_at,subject_id,status,model_name,prompt_version,input_tokens,output_tokens,pre_estimated_cost,estimated_cost,duration_ms,target_quiz_id,error_message",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (subjectScope !== null) {
    if (!subjectScope.length) return [];
    query = query.in("subject_id", subjectScope);
  }
  const [{ data, error }, { data: subjects, error: subjectError }] = await Promise.all([
    query,
    appSchema()
      .from("subjects")
      .select("id,name")
      .eq("organization_id", organizationId),
  ]);
  if (error || subjectError) throw new Error(error?.message || subjectError?.message || "Falha ao exportar IA.");
  const subjectMap = new Map((subjects ?? []).map((item) => [item.id, item.name]));
  return (data ?? []).map((item) => ({
    criado_em: item.created_at,
    materia: subjectMap.get(item.subject_id) || "",
    status: item.status,
    modelo: item.model_name,
    versao_prompt: item.prompt_version,
    tokens_entrada: item.input_tokens,
    tokens_saida: item.output_tokens,
    custo_estimado_usd: item.pre_estimated_cost,
    custo_real_usd: item.estimated_cost,
    duracao_ms: item.duration_ms,
    simulado_destino_id: item.target_quiz_id,
    erro: item.error_message,
  }));
}

async function exportFilteredResponses(
  filters: RankingFilters,
): Promise<Row[]> {
  const ranking = await getRankings(filters);
  return ranking.map((item) => ({
    posicao: item.position,
    apelido: item.nickname,
    turma: item.className,
    materia: item.subject,
    simulado: item.quiz,
    pontuacao: item.score,
    acertos: item.correct,
    erros: item.wrong,
    respondidas: item.answered,
    precisao_percentual: item.accuracy,
    duracao_segundos: item.durationSeconds,
    enviado_em: item.submittedAt || "",
  }));
}

function rankingFiltersFromUrl(url: URL): RankingFilters {
  const sortValues = new Set<NonNullable<RankingFilters["sort"]>>([
    "score",
    "correct",
    "accuracy",
    "time",
    "recent",
  ]);
  const modeValues = new Set<NonNullable<RankingFilters["mode"]>>([
    "best",
    "all",
  ]);
  const sort = url.searchParams.get("sort") as NonNullable<
    RankingFilters["sort"]
  > | null;
  const mode = url.searchParams.get("mode") as NonNullable<
    RankingFilters["mode"]
  > | null;
  return {
    classId: url.searchParams.get("classId") || undefined,
    quizId: url.searchParams.get("quizId") || undefined,
    subjectId: url.searchParams.get("subjectId") || undefined,
    sort: sort && sortValues.has(sort) ? sort : "correct",
    mode: mode && modeValues.has(mode) ? mode : "best",
  };
}

function toCsv(items: Row[]): string {
  if (!items.length) return "sem_dados\r\n";
  const headers = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const lines = [headers.map(escapeCell).join(";")];
  for (const item of items)
    lines.push(
      headers
        .map((header) => escapeCell(normalizeValue(item[header])))
        .join(";"),
    );
  return lines.join("\r\n");
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCell(value: unknown): string {
  const text = normalizeValue(value).replace(/\r?\n/g, " ");
  // Impede que planilhas interpretem conteúdo importado como fórmula ao abrir o CSV.
  const safeText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[;"\n]/.test(safeText)
    ? `"${safeText.replace(/"/g, '""')}"`
    : safeText;
}
