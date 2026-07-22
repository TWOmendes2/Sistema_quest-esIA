import Link from 'next/link';
import { Avatar, Badge, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getStudents } from '@/server/data/admin';
import { formatDate } from '@/lib/format';
import { requireManagementRoles } from '@/server/data/context';

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireManagementRoles(['admin', 'coordinator']);
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim() : '';
  const students = await getStudents(query);

  return <>
    <PageHeader eyebrow="Gestão acadêmica" title="Alunos" description="Pesquise por nome completo, apelido, CPF ou e-mail." actions={<><a href="/api/admin/exports/students" className="app-button-secondary"><Icon name="download" className="h-4 w-4" /> Exportar</a><Link href="/admin/alunos/importar" className="app-button-primary"><Icon name="upload" className="h-4 w-4" /> Importar alunos</Link></>} />
    <form method="get" className="app-card mb-6 flex flex-col gap-3 p-4 sm:flex-row">
      <div className="relative flex-1"><Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666]" /><input name="q" defaultValue={query} className="app-input pl-10" placeholder="Nome, apelido, CPF completo ou e-mail" autoComplete="off" /></div>
      <button className="app-button-primary"><Icon name="search" className="h-4 w-4" /> Pesquisar</button>
      {query ? <Link href="/admin/alunos" className="app-button-secondary">Limpar</Link> : null}
    </form>
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={query ? 'Resultados' : 'Alunos ativos'} value={query ? students.length : students.filter((item) => item.status === 'active').length} icon="users" tone="primary" />
      <StatCard label="Cadastros exibidos" value={students.length} icon="plus" tone="success" />
      <StatCard label="Aguardando acesso" value={students.filter((item) => item.status === 'pending' || item.status === 'imported').length} icon="alert" tone="warning" />
      <StatCard label="Bloqueados" value={students.filter((item) => item.status === 'blocked').length} icon="lock" tone="danger" />
    </div>
    <div className="app-table-wrap"><table className="app-table min-w-[1100px]"><thead><tr><th>Aluno</th><th>CPF protegido</th><th>Turmas</th><th>Matérias</th><th>Último acesso</th><th>Status</th><th></th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td><div className="flex items-center gap-3"><Avatar name={student.name} size="sm" /><div><p className="font-semibold text-white">{student.name}</p><p className="mt-1 text-xs text-[#666]">{student.registryOnly ? 'Aguardando primeiro acesso' : `@${student.nickname}`} · {student.email}</p></div></div></td><td><span className="font-mono text-xs">***.***.***-{student.cpfLast4.slice(-2)}</span></td><td><div className="flex max-w-xs flex-wrap gap-1">{student.classNames.length ? student.classNames.map((item) => <Badge key={item}>{item}</Badge>) : '—'}</div></td><td>{student.subjects.length}</td><td>{student.lastAccess ? formatDate(student.lastAccess, true) : 'Nunca acessou'}</td><td><StatusBadge status={student.status} /></td><td className="text-right"><Link href={`/admin/alunos/${student.id}`} className="app-button-secondary px-3 py-2"><Icon name="eye" className="h-4 w-4" /> Detalhes</Link></td></tr>)}</tbody></table></div>
    {!students.length ? <div className="app-card mt-4 p-12 text-center text-sm text-[#777]">{query ? 'Nenhum aluno encontrado para essa pesquisa.' : 'Nenhum aluno cadastrado. Use a importação para começar.'}</div> : null}
  </>;
}
