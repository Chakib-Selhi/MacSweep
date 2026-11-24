import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TRASH_ONLY = 'Règle 4 : on ne supprime jamais, on utilise shell.trashItem.';
const DELETING_FS_CALLS = ['rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync'];

// The only file allowed to delete for real: emptying the Trash after the double confirmation (M4).
const TRASH_EMPTY_MODULE = 'src/main/trash-empty.ts';

export default tseslint.config(
  { ignores: ['.vite/', 'out/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [TRASH_EMPTY_MODULE],
    rules: {
      'no-restricted-properties': [
        'error',
        ...DELETING_FS_CALLS.map((property) => ({ property, message: TRASH_ONLY })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'rimraf', message: TRASH_ONLY },
            { name: 'del', message: TRASH_ONLY },
            { name: 'fs-extra', message: TRASH_ONLY },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportDeclaration[source.value=/^(node:)?fs(\\/promises)?$/] ImportSpecifier[imported.name=/^(${DELETING_FS_CALLS.join('|')})$/]`,
          message: TRASH_ONLY,
        },
        {
          selector:
            'ImportDeclaration[source.value=/^(node:)?child_process$/] ImportSpecifier[imported.name=/^(exec|execSync)$/]',
          message: 'Utiliser execFile avec des arguments fixes : jamais de shell.',
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', 'fs', 'path', 'os', 'child_process', '**/main/**'],
              message: "Règle 2 : l'interface passe uniquement par window.macsweep.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
