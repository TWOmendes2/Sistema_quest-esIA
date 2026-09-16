# ADR 0001 — Preservar o monólito modular

Status: aceito para esta revisão.

Contexto: o produto já separa rotas, componentes, regras de pontuação, autenticação,
persistência e integração de IA. A necessidade atual é demonstrar e validar essas
fronteiras, sem trocar stack ou dividir serviços.

Decisão: manter Next.js e a estrutura existente; acrescentar documentação e testes
nas regras puras. Adiar alterações estruturais até existir problema mensurável.

Consequências: revisão menor e menor risco de regressão. Os limites em memória,
operações privilegiadas e dependência do banco continuam exigindo testes próprios.
Alternativa adiada: microsserviço separado para IA, com custo de operação e coordenação.
