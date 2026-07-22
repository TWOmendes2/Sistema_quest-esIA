import { PageHeader } from '@/components/ui';
import { ImportStudentsWizard } from '@/components/import-students-wizard';
import { requireManagementRoles } from '@/server/data/context';

export default async function ImportStudentsPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  return (
    <>
      <PageHeader backHref="/admin/alunos" eyebrow="Base oficial" title="Importar alunos" description="Valide, pré-visualize e confirme arquivos CSV ou XLSX com segurança e rastreabilidade." />
      <ImportStudentsWizard />
    </>
  );
}
