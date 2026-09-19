import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import tsPlugin from '@typescript-eslint/eslint-plugin';
const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**'] },
  ...compat.extends('next/core-web-vitals'),
  { plugins: { '@typescript-eslint': tsPlugin }, linterOptions: { reportUnusedDisableDirectives: false } },
];

export default config;
