import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo']
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Supabase is used without generated database types in this MVP. Dynamic rows are
      // normalized at the data-layer boundary before reaching UI components.
      '@typescript-eslint/no-explicit-any': 'off',
      // Internal API routes intentionally use regular anchors to trigger file downloads.
      '@next/next/no-html-link-for-pages': 'off'
    }
  }
];

export default eslintConfig;
