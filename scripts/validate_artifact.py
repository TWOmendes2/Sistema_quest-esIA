from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / 'supabase/migrations/001_initial_schema_rls.sql'

errors = []
warnings = []

sql = SQL.read_text(encoding='utf-8')

if 'create schema if not exists app;' not in sql.lower():
    errors.append('SQL não cria o schema app no início.')

schema_pos = sql.lower().find('create schema if not exists app;')
type_pos = sql.lower().find('create type app.')
if type_pos != -1 and schema_pos > type_pos:
    errors.append('Tipos app.* aparecem antes da criação do schema app.')

if 'create policy if not exists' in sql.lower():
    errors.append('Postgres não suporta create policy if not exists neste contexto.')

created_tables = set(re.findall(r'create table if not exists app\.([a-z_]+)', sql, flags=re.I))
rls_tables = set(re.findall(r'alter table app\.([a-z_]+) enable row level security', sql, flags=re.I))
policy_tables = set(re.findall(r'on app\.([a-z_]+)\s*\nfor ', sql, flags=re.I))

missing_rls_tables = sorted(rls_tables - created_tables)
missing_policy_tables = sorted(policy_tables - created_tables)
if missing_rls_tables:
    errors.append(f'RLS referencia tabelas não criadas: {missing_rls_tables}')
if missing_policy_tables:
    errors.append(f'Policies referenciam tabelas não criadas: {missing_policy_tables}')

required_tables = {
    'organizations', 'memberships', 'students_registry', 'student_profiles', 'classes', 'subjects',
    'enrollments', 'quizzes', 'quiz_questions', 'question_options', 'question_answer_keys',
    'quiz_assignments', 'attempts', 'attempt_answers', 'rank_snapshots', 'content_sources',
    'ai_jobs', 'audit_logs'
}
missing_required = sorted(required_tables - created_tables)
if missing_required:
    errors.append(f'Tabelas obrigatórias ausentes: {missing_required}')

for path in ROOT.rglob('*'):
    if path.is_file() and path.suffix in {'.ts', '.tsx', '.sql'}:
        text = path.read_text(encoding='utf-8')
        if 'SUPABASE_SERVICE_ROLE_KEY=' in text and path.name != '.env.example':
            errors.append(f'Possível chave exposta em {path.relative_to(ROOT)}')
        if 'TODO' in text:
            warnings.append(f'TODO encontrado em {path.relative_to(ROOT)}')
        for open_char, close_char in [('(', ')'), ('{', '}'), ('[', ']')]:
            if text.count(open_char) != text.count(close_char):
                warnings.append(f'Contagem de {open_char}{close_char} diferente em {path.relative_to(ROOT)}')

report = []
report.append('# Relatório de validação local\n')
report.append('Validações executadas sobre SQL e arquivos TypeScript antes da compactação.\n')
report.append(f'- Tabelas criadas no schema app: {len(created_tables)}')
report.append(f'- Tabelas com RLS ativado: {len(rls_tables)}')
report.append(f'- Tabelas com policies diretas: {len(policy_tables)}')
report.append(f'- Erros encontrados: {len(errors)}')
report.append(f'- Alertas encontrados: {len(warnings)}\n')

if errors:
    report.append('## Erros\n')
    report.extend(f'- {item}' for item in errors)
else:
    report.append('## Erros\n- Nenhum erro estrutural encontrado.\n')

if warnings:
    report.append('\n## Alertas\n')
    report.extend(f'- {item}' for item in warnings)
else:
    report.append('\n## Alertas\n- Nenhum alerta relevante encontrado.\n')

(ROOT / 'VALIDATION_REPORT.md').write_text('\n'.join(report) + '\n', encoding='utf-8')
if errors:
    raise SystemExit('\n'.join(errors))
print('validation-ok')
