import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules/', '.claude/', 'plugin/.claude-plugin/types/', '.gitnexus/', '.fallow/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The engine accepts async key/click handlers and awaits nothing from them
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false, arguments: false } }],
    },
  },
  {
    // Strips terminal escape sequences on purpose
    files: ['plugin/hooks/core/redact.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    // Fakes implement async engine interfaces without awaiting anything
    files: ['plugin/tests/**'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
)
