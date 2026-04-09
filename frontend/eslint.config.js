const nextConfig = require('eslint-config-next');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...nextConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react/no-unstable-nested-components': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
];
