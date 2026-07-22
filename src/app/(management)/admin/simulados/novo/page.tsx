import { PageHeader } from '@/components/ui';
import { NewQuizWizard } from '@/components/new-quiz-wizard';
import { getClasses, getSubjects } from '@/server/data/admin';

export default async function NewQuizPage() {
  const [subjects, classes] = await Promise.all([getSubjects(), getClasses()]);
  return <><PageHeader backHref="/admin/simulados" eyebrow="Criação" title="Novo simulado" description="Crie o rascunho com dados reais e avance para o editor de questões." /><NewQuizWizard subjects={subjects} classes={classes} /></>;
}
