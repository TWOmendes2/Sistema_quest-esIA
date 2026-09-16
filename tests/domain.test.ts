import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAttempt, scoreQuestion } from '../src/server/scoring/scoring';
import { generatedQuestionSchema } from '../src/server/ai/question-schema';

const question = {
  questionId: 'synthetic', difficulty: 'hard' as const,
  expectedTimeSeconds: 90, elapsedSeconds: 30, isCorrect: true,
};

test('browser elapsed time never increases score', () => {
  assert.deepEqual(scoreQuestion(question), scoreQuestion({ ...question, elapsedSeconds: -999 }));
});
test('empty attempt is zero, wrong answer earns no points', () => {
  assert.equal(scoreAttempt([]).normalized, 0);
  assert.equal(scoreAttempt([{ ...question, isCorrect: false }]).normalized, 0);
  assert.equal(scoreAttempt([question]).normalized, 100);
});
test('weighted scoring uses difficulty and counts answers', () => {
  const result = scoreAttempt([question, { ...question, questionId: 'other', difficulty: 'easy', isCorrect: false }]);
  assert.equal(result.normalized, 66.67);
  assert.equal(result.correctCount, 1);
  assert.equal(result.wrongCount, 1);
});

const draft = {
  statement: 'Enunciado sintético para teste', topic: 'Tema', subtopic: 'Subtema',
  difficulty: 'easy', expected_time_seconds: 60, correct_label: 'A',
  explanation_correct: 'Explicação sintética correta', explanation_wrong: 'Explicação sintética incorreta',
  options: ['A', 'B', 'C', 'D', 'E'].map(label => ({ label, text: 'Alternativa ' + label })),
};
test('accepts a complete synthetic draft', () => assert.ok(generatedQuestionSchema.safeParse(draft).success));
test('rejects duplicated option labels', () => {
  assert.equal(generatedQuestionSchema.safeParse({ ...draft, options: draft.options.map(x => ({ ...x, label: 'A' })) }).success, false);
});
test('rejects equivalent option text', () => {
  assert.equal(generatedQuestionSchema.safeParse({ ...draft, options: draft.options.map(x => ({ ...x, text: ' igual ' })) }).success, false);
});
