-- Nexo Avalia - hotfix de compatibilidade das métricas de IA
-- Execute após 001, 002 e 003. É idempotente e pode ser executado novamente.
-- Corrige bancos criados antes da inclusão das colunas de pré-estimativa e duração.

alter table app.ai_jobs
  add column if not exists pre_estimated_input_tokens integer,
  add column if not exists pre_estimated_output_tokens integer,
  add column if not exists pre_estimated_cost numeric(12,6),
  add column if not exists duration_ms integer;

alter table app.content_sources
  add column if not exists character_count integer;

comment on column app.ai_jobs.pre_estimated_input_tokens is
  'Estimativa de tokens de entrada calculada antes da chamada ao modelo.';
comment on column app.ai_jobs.pre_estimated_output_tokens is
  'Estimativa de tokens de saída calculada antes da chamada ao modelo.';
comment on column app.ai_jobs.pre_estimated_cost is
  'Custo estimado em USD antes da chamada ao modelo.';
comment on column app.ai_jobs.duration_ms is
  'Duração total da geração em milissegundos.';

-- Verificação: a consulta deve retornar cinco linhas.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema = 'app'
  and (
    (table_name = 'ai_jobs' and column_name in (
      'pre_estimated_input_tokens',
      'pre_estimated_output_tokens',
      'pre_estimated_cost',
      'duration_ms'
    ))
    or (table_name = 'content_sources' and column_name = 'character_count')
  )
order by table_name, column_name;
