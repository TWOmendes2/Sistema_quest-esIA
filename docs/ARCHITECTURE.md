# Arquitetura

```text
Navegador → Next.js App Router → Supabase Auth/PostgreSQL/Storage
                              ↘ Gemini / Resend
```

Server Components fazem leituras iniciais; Route Handlers recebem mutações e validam payloads. O domínio usa o schema `app`. As tabelas carregam `organization_id`, e professores recebem escopos em `teacher_assignments`. `class_id = null` significa todas as turmas da matéria. RLS e validação de backend formam defesa em profundidade.

A IA cria jobs auditáveis, registra métricas e mantém questões em revisão antes de incorporá-las ao banco reutilizável.

## Mapa de responsabilidades

- `src/app/api`: contratos HTTP, entrada de mutações e jobs.
- `src/server/auth` e `data`: sessão, gestão e escopo de leitura/escrita.
- `src/server/ai`: geração, schema, estimativa e persistência.
- `src/server/scoring`: pontuação pura, sem bônus por tempo informado pelo navegador.
- `src/server/audit`: trilha de ações; `security`: hash e limites locais.
- `supabase`: evolução de banco e políticas, a verificar em ambiente descartável.

Limites de confiança: navegador → rota autenticada → cliente privilegiado → banco;
texto do usuário → provedor de IA → schema → revisão → persistência. Cada passagem
exige validação própria. A revisão atual preserva código e estrutura de produção.
