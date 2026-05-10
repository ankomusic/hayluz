const commonGlobals = {
  AbortController: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  globalThis: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly'
};

const rules = {
  'arrow-parens': 'off',
  'comma-dangle': ['error', 'never'],
  curly: 'off',
  eqeqeq: ['error', 'always'],
  indent: ['error', 2],
  'no-console': 'off',
  'no-undef': 'off',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'off',
  quotes: ['error', 'single', { avoidEscape: true }],
  semi: ['error', 'always']
};

module.exports = [
  {
    ignores: ['node_modules/**', '.vercel/**']
  },
  {
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: commonGlobals,
      sourceType: 'commonjs'
    },
    rules
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...commonGlobals,
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly'
      },
      sourceType: 'module'
    },
    rules
  }
];
