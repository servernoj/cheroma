import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import { defineConfig } from 'eslint/config'
import globals from 'globals'


export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: ['js/recommended'],
    plugins: {
      js,
      import: importPlugin,
    },
    languageOptions: {
      globals: globals.node
    },
    settings: {
      'import/resolver': {
        alias: {
          extensions: ['.js'],
          map: [
            ['@', './src']
          ],
        },
        node: {
          extensions: ['.js'],
        },
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-fallthrough': 'warn',
      'no-prototype-builtins': 'warn',
      'quote-props': ['error', 'as-needed'],
      quotes: ['error', 'single'],
      semi: ['error', 'never'],
      indent: ['error', 2, { SwitchCase: 1 }],
      'import/no-unresolved': ['error', { commonjs: false, caseSensitive: true }]
    },
    ignores: [
      '**/dist/*',
      '**/node_modules/*',
      '**/dbData/*'
    ]
  }
])
