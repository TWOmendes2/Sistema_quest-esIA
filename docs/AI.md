# Pipeline de IA

Os endpoints em `src/app/api/ai` recebem solicitações e acompanham jobs.
`src/server/ai/gemini.ts` integra o provedor; `question-schema.ts` define o contrato;
`persist-generated-quiz.ts` implementa a persistência. A estimativa está em `estimate.ts`.

O contrato exige cinco alternativas A–E, textos distintos, dificuldade e explicações.
Zod rejeita rótulos duplicados e alternativas “todas/nenhuma das anteriores”. Esses
controles evitam erros de formato, mas não detectam toda alucinação, viés ou erro factual.

Estimativas de tokens, duração e custo são heurísticas configuráveis, não faturamento
confirmado. Separe estimativa de consumo retornado pelo provedor na avaliação operacional.
Use fontes didáticas autorizadas e preserve rastreabilidade sem armazenar PII em prompts.

## Avaliação proposta

Conjunto de referência sintético por matéria/dificuldade; taxa de schema válido,
correção do gabarito avaliada por professor, duplicação, custo por questão aceita e
latência. Registre versão do prompt/modelo e compare antes de trocar o modelo.
Não há benchmark de qualidade pedagógica publicado neste repositório.
