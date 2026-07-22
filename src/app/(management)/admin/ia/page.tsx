import { PageHeader } from '@/components/ui';
import { AiGenerator } from '@/components/ai-generator';
import { getAiJobs, getClasses, getQuizzes, getSubjects } from '@/server/data/admin';

export default async function AiPage() {
  const [subjects, classes, quizzes, jobs] = await Promise.all([getSubjects(), getClasses(), getQuizzes(), getAiJobs()]);
  return <><PageHeader eyebrow="Inteligência artificial" title="Geração de questões" description="Gere questões a partir de conteúdo real, acompanhe custos e revise antes de publicar." actions={<a href="/api/admin/exports/ai" className="app-button-secondary">Exportar histórico</a>} /><AiGenerator subjects={subjects} classes={classes} quizzes={quizzes} initialJobs={jobs} /></>;
}
