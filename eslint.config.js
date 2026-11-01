import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['scripts/**', 'e2e/**', 'playwright.config.ts', 'playwright.screens.config.ts', 'playwright.popup-screens.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Playwright fixtures must destructure their dependencies, even when empty; `use` is Playwright's, not a React hook.
    files: ['e2e/fixtures.ts'],
    rules: { 'no-empty-pattern': 'off', 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    rules: {
      // Foreign content must never be rendered as HTML.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden.',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden.',
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Assigning innerHTML/outerHTML is forbidden.',
        },
        {
          selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write)$/]",
          message: 'insertAdjacentHTML and document.write are forbidden.',
        },
      ],
    },
  },
);
