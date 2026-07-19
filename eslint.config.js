'use strict';
// Flat ESLint config covering server/ (CommonJS Node) and client/ (React/JSX,
// ES modules via Vite). apps/arops-mobile and packages/arops-shared are
// deliberately excluded — they're TypeScript with their own toolchains
// (tsc/expo), a plain-JS config here isn't the right tool for them.
//
// Deliberately not reformatting/re-linting the entire existing codebase in
// one pass — this establishes the baseline for new/touched code going
// forward (see the backend redesign plan, Phase 0).
const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'client/build/**',
      // Plain <script>-tag debug-harness files (ar-game.html & friends) —
      // globals are shared across files by load order, not by module
      // import/export, so no-undef would just be noise here.
      'client/public/**',
      'packages/**',
      'apps/**',
      'hardware/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Existing violations in server/src/game/engine.js (Spirale — out of
      // scope for this redesign) and a few empty catch blocks elsewhere;
      // downgraded to warn so the baseline lint run isn't red on day one.
      // Fix opportunistically when those files are next touched.
      'no-undef': 'warn',
      'no-empty': 'warn',
      'no-dupe-keys': 'warn',
    },
  },
  {
    files: ['client/src/**/*.{js,jsx}', 'client/*.js'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' }, // Vite `define` build-time constant, see client/vite.config.js
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules, // Vite's JSX transform — no `import React` needed in scope
      ...reactHooks.configs['recommended-latest'].rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Plain JS, no PropTypes anywhere in this codebase and no plan to add
      // any — type safety is the TS-migration roadmap item, not PropTypes.
      'react/prop-types': 'off',
      // Newer stricter react-hooks rules (React 19-oriented) — real hits in
      // existing components, but fixing them is a behavioral change, not a
      // lint-config task. Downgraded to warn; revisit during the React 19 bump.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      // Same reasoning as the server block: real pre-existing issues, but
      // fixing them is out of scope for a lint-config task. Warn, not error.
      'no-undef': 'warn',
      'no-empty': 'warn',
      'no-dupe-keys': 'warn',
    },
    settings: { react: { version: 'detect' } },
  },
  prettierConfig,
];
