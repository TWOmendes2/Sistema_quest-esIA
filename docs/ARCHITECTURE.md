# Arquitetura

```text
Navegador → Next.js App Router → Supabase Auth/PostgreSQL/Storage
                              ↘ Gemini / Resend
```

Server Components fazem leituras iniciais; Route Handlers recebem mutações e validam payloads. O domínio usa o schema `app`. As tabelas carregam `organization_id`, e professores recebem escopos em `teacher_assignments`. `class_id = null` significa todas as turmas da matéria. RLS e validação de backend formam defesa em profundidade.

A IA cria jobs auditáveis, registra métricas e mantém questões em revisão antes de incorporá-las ao banco reutilizável.
