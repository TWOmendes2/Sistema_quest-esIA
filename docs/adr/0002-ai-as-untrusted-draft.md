# ADR 0002 — IA produz rascunhos validados

Status: documentação da direção arquitetural existente.

Contexto: JSON bem formado pode conter gabarito incorreto ou conteúdo inadequado.
Decisão: combinar schema estruturado, validação local e revisão pedagógica; não
atribuir à validação de schema a garantia de qualidade factual.

Consequências: latência e trabalho de revisão são parte do produto. Métricas devem
medir questões aceitas, não apenas volume gerado. A fiscalização desse fluxo em
todas as rotas precisa de testes de integração conforme o roadmap.
