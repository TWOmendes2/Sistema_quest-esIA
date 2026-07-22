import { authorizeManagement } from '@/server/auth/management';

export async function GET(request: Request) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const csv = [
    'CPF;NOME;EMAIL;TELEFONE;TELEFONE INT;DATA DE NASCIMENTO;CIDADE;NOME RESPONSÁVEL;TELEFONE RESPONSÁVEL;SÉRIE;INSTAGRAM;TURMAS ATIVAS;TURMAS ANTIGAS;TURMAS INADIMPLENTES;CONTRATOS PENDENTES',
    '000.000.000-00;Nome do aluno;aluno@exemplo.com;(11)99999-9999;5511999999999;01/01/2008;São Paulo;Nome do responsável;(11)98888-8888;3º Ano;@aluno;FÍSICA - TURMA DEMONSTRAÇÃO;;;FÍSICA - TURMA DEMONSTRAÇÃO'
  ].join('\r\n');
  return new Response(`\uFEFF${csv}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="modelo-importacao-alunos-nexo.csv"',
      'cache-control': 'no-store'
    }
  });
}
