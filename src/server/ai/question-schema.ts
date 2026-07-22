import { z } from 'zod';

export const generatedOptionSchema = z.object({
  label: z.enum(['A', 'B', 'C', 'D', 'E']),
  text: z.string().min(1).max(1200)
});

export const generatedQuestionSchema = z.object({
  statement: z.string().min(10).max(6000),
  topic: z.string().min(2).max(180),
  subtopic: z.string().min(2).max(180),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  expected_time_seconds: z.number().int().min(30).max(900),
  options: z.array(generatedOptionSchema).length(5),
  correct_label: z.enum(['A', 'B', 'C', 'D', 'E']),
  explanation_correct: z.string().min(10).max(5000),
  explanation_wrong: z.string().min(10).max(5000)
}).superRefine((question, context) => {
  const labels = question.options.map((option) => option.label);
  if (new Set(labels).size !== 5 || !['A', 'B', 'C', 'D', 'E'].every((label) => labels.includes(label as typeof labels[number]))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Cada questão deve conter exatamente as alternativas A, B, C, D e E.', path: ['options'] });
  }

  const normalizedOptions = question.options.map((option) => option.text.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '));
  if (new Set(normalizedOptions).size !== 5) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'As cinco alternativas devem ter textos diferentes.', path: ['options'] });
  }

  const forbidden = /\b(todas as (alternativas|anteriores)|nenhuma das (alternativas|anteriores))\b/i;
  question.options.forEach((option, index) => {
    if (forbidden.test(option.text)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Não use alternativas do tipo todas/nenhuma das anteriores.', path: ['options', index, 'text'] });
    }
  });
});

export const generatedQuizSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(2000),
  questions: z.array(generatedQuestionSchema).min(1).max(50)
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;

export const geminiResponseSchema = {
  type: 'object',
  required: ['title', 'description', 'questions'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'statement', 'topic', 'subtopic', 'difficulty', 'expected_time_seconds',
          'options', 'correct_label', 'explanation_correct', 'explanation_wrong'
        ],
        properties: {
          statement: { type: 'string' },
          topic: { type: 'string' },
          subtopic: { type: 'string' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          expected_time_seconds: { type: 'integer', minimum: 30, maximum: 900 },
          options: {
            type: 'array',
            minItems: 5,
            maxItems: 5,
            items: {
              type: 'object',
              required: ['label', 'text'],
              properties: {
                label: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
                text: { type: 'string' }
              }
            }
          },
          correct_label: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
          explanation_correct: { type: 'string' },
          explanation_wrong: { type: 'string' }
        }
      }
    }
  }
} as const;
