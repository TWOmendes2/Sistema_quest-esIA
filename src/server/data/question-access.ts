import "server-only";
import { appSchema } from "@/server/supabase/admin";

export type OwnedQuestionContext = {
  questionId: string;
  quizId: string;
  subjectId: string;
  quiz: {
    id: string;
    title: string;
    organization_id: string;
    status: string;
    subject_id: string;
  };
};

export async function getOwnedQuestionContext(
  questionId: string,
  organizationId: string,
): Promise<OwnedQuestionContext | null> {
  const { data: question, error: questionError } = await appSchema()
    .from("quiz_questions")
    .select("id,quiz_id,subject_id")
    .eq("id", questionId)
    .maybeSingle();

  if (questionError) throw questionError;
  if (!question) return null;

  const { data: quiz, error: quizError } = await appSchema()
    .from("quizzes")
    .select("id,title,organization_id,status,subject_id")
    .eq("id", question.quiz_id)
    .maybeSingle();

  if (quizError) throw quizError;
  if (!quiz || quiz.organization_id !== organizationId) return null;

  return {
    questionId: question.id,
    quizId: question.quiz_id,
    subjectId: question.subject_id,
    quiz,
  };
}

export async function prepareQuizForQuestionMutation(
  quizId: string,
  currentStatus: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!["draft", "review", "published"].includes(currentStatus)) {
    return { ok: false, message: "O simulado não aceita edição de questões." };
  }

  const { count, error: countError } = await appSchema()
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("quiz_id", quizId)
    .eq("status", "submitted");

  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message:
        "Este simulado já possui respostas enviadas. Para preservar o histórico, as questões não podem mais ser alteradas; duplique o simulado para criar uma nova versão.",
    };
  }

  if (currentStatus === "published") {
    const { error } = await appSchema()
      .from("quizzes")
      .update({ status: "review", published_at: null, published_by: null })
      .eq("id", quizId)
      .eq("organization_id", organizationId);

    if (error) throw error;
  }

  return { ok: true };
}
