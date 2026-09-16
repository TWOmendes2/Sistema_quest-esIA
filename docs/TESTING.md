# Testes e evidências

```sh
npm ci
npm test
npm run validate
npm run build
```

`npm test` executa testes do domínio de pontuação e do contrato das questões geradas,
sem chamadas externas. `validate` combina TypeScript, ESLint e verificações estáticas
dos fluxos prioritários, escopo de professores e publicação. Buscas estáticas não
substituem testes de autorização em tempo de execução.

Próxima camada: fixtures com duas organizações em banco descartável; login e recuperação
de senha; professor fora da matéria; tentativa de aluno alheio; conclusão duplicada
de job; indisponibilidade da IA e rollback. E2E e RLS remotos não foram executados
por esta alteração documental. Não use produção para esses testes.
