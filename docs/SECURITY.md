# Fronteiras de segurança

Esta é uma revisão de código e documentação, não um pentest nem uma validação de
uma implantação. Nenhum banco remoto foi consultado ou alterado nesta revisão.

## Autorização

Sessão e gestão estão em `src/server/auth`; acesso a questões em
`src/server/data/question-access.ts`; credencial administrativa em
`src/server/supabase/admin.ts`. Cada operação privilegiada precisa validar organização,
papel e atribuição de matéria/turma antes de usar esse cliente. Uma chave administrativa
no servidor não torna a consulta automaticamente isolada por organização.

Revise grants, políticas RLS, views e funções SECURITY DEFINER nas migrações.
Testes com aluno, professor e gestor de duas organizações devem negar acesso cruzado
em SELECT/INSERT/UPDATE/DELETE. Confira também exportações, uploads e redefinição de
senha. Não trate `user_metadata` como fonte confiável de autorização.

## Limitação conhecida

`src/server/security/rate-limit.ts` usa Map em memória. Limites não são compartilhados
entre instâncias e reiniciam com o processo; entradas precisam de política de limpeza.
Antes de escalar, use um armazenamento compartilhado com expiração e testes concorrentes.

## Dados e IA

Não enviar CPFs, credenciais ou dados de alunos em prompts. Logs/auditoria devem
registrar identificadores técnicos e resultado, com acesso e retenção definidos.
Texto enviado à IA e respostas geradas são dados não confiáveis. Validação estrutural
não certifica qualidade pedagógica; mantenha revisão humana.

## Verificação operacional pendente

Rotação de segredos via ambiente, backups restauráveis, cookies seguros, política de
retenção, testes de RLS em banco descartável e revisão de dependências no lockfile.
Referência: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
