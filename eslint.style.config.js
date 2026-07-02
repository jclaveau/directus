import { defineConfig } from "eslint/config"
import globals from "globals"
import js from "@eslint/js"
import tseslint from 'typescript-eslint'
import vue from "eslint-plugin-vue"
import customArrayElementNewline from './eslint-rules/custom-array-element-newline.js'
import arrowMultilineBlock from './eslint-rules/arrow-multiline-block.js'
import stringLiteralsMaxLen from './eslint-rules/string-literals-max-len.js'

export const appGlobals = {
  front: {
    ...globals.browser,
    chrome: `readonly`,
  },
  back: {
    ...globals.node,
    process: `readonly`,
    // custom
    __filename: `off`,
    __dirname: `off`,
  },
}

// TODO example to follow
// https://eslint.vuejs.org/user-guide/#example-configuration-with-typescript-eslint-and-prettier
export const eslintBaseConfig = defineConfig([
  tseslint.configs.recommended,
  js.configs.recommended,
  ...vue.configs[`flat/recommended`],
  {
    files: [
      `**/*.ts`,
      `**/*.js`,
      `**/*.mjs`,
      `**/*.cjs`,
      `**/*.vue`,
    ],
    ignores: [
      `dist`,
      `node_modules`,
    ],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: `commonjs`,

      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [`.vue`],
      },
    },

    plugins: { local: { rules: {
      'custom-array-element-newline': customArrayElementNewline,
      'arrow-multiline-block': arrowMultilineBlock,
      'string-literals-max-len': stringLiteralsMaxLen,
    } } },

    rules: {
      'prefer-promise-reject-errors': `off`,

      // quotes: ['warn', 'single', { avoidEscape: true }],

      // this rule, if on, would require explicit return type on the `render` function
      '@typescript-eslint/explicit-function-return-type': `off`,

      // in plain CommonJS modules, you can't use `import foo = require('foo')` to pass this rule,
      // so it has to be disabled
      '@typescript-eslint/no-var-requires': `off`,

      // The core 'no-unused-vars' rules (in the eslint:recommended ruleset)
      // does not work with type definitions
      'no-unused-vars': `off`,
      '@typescript-eslint/no-unused-vars': `off`,

      // Preset (js/tseslint recommended) QUALITY rules that aren't style — turned off so the
      // diff-scoped gate (scripts/lint-style-changes.mjs) reports only this config's style rules.
      // directus leans on `any`; intentional interface merges trip no-redeclare.
      '@typescript-eslint/no-explicit-any': `off`,
      'no-redeclare': `off`,
      // '@typescript-eslint/no-unused-vars': [`warn`, {
      //   "argsIgnorePattern": `^_`,
      //   "varsIgnorePattern": `^_`,
      //   "caughtErrorsIgnorePattern": `^_`,
      // }],

      // allow debugger during development only
      'no-debugger': process.env.NODE_ENV === `production` ? `error` : `off`,

      // USAGE / STYLE
      // commented: prettier owns indentation in directus (tabs); eslint `indent`
      // would reflow ~93% of every changed file. See eslint.style.config notes.
      // 'indent': [`error`, 2, {                                      // https://stackoverflow.com/questions/47566534/eslint-indent-with-chained-methods
      //   "MemberExpression": 0,
      //   // "flatTernaryExpressions": true,                             // https://eslint.org/docs/latest/rules/indent#flatternaryexpressions
      //   // "offsetTernaryExpressions": false,                          // https://eslint.org/docs/latest/rules/indent#offsetternaryexpressions
      //   // TODO Prettier new reco?
      // }],
      // 'no-nested-ternary': `error`,                                 // https://eslint.org/docs/latest/rules/no-nested-ternary
      // commented: directus uses semicolons (prettier); semi:never strips them all.
      // 'semi': [`error`, `never`],                                   // https://eslint.org/docs/latest/rules/semi#options
      'prefer-template': `error`,
      "max-len": [`error`, {                                        // https://eslint.org/docs/latest/rules/max-len
        code: 90,
        tabWidth: 2,
        comments: 110,
        ignoreUrls: true,
        ignoreTrailingComments: true,
        ignoreRegExpLiterals: true,
        // Both string exemptions are OFF for scalabus (planner keeps them on for ts/js): a string
        // literal — plain or template — must not exempt its line from the 90-col cap, or long
        // strings (assertions, URLs, error text) hide behind it and soft-wrap in the review pane.
        // ignoreStrings: true,
        // ignoreTemplateLiterals: true,
        // The one carve-out: a `test`/`it`/`describe` title line (and the `.each([...])('title')`
        // form, whose title sits on a line starting with `])(`). Those titles ARE breakable — the
        // `local/string-literals-max-len` rule owns their length (wrap + word-wrap in oneLine), so
        // exempt the opening line here to avoid a redundant report; the wrapped body lines are not
        // exempt and still get checked.
        ignorePattern: `^\\s*(it|test|describe)\\(|^\\s*\\]\\)\\(`,
      }],
      "@typescript-eslint/no-unused-expressions": [                 // https://eslint.org/docs/latest/rules/no-unused-expressions
        `error`,
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: false,
        },
      ],
      // commented: override `!`:true forces `! x`; prettier wants `!x`.
      // 'space-unary-ops': [
      //   2, {
      //     "words": false,
      //     "nonwords": false,
      //     "overrides": {
      //       "!": true,
      //       // "!!": true,
      //     },
      //   },
      // ],


      // COMMENTABLE CODE
      'multiline-ternary': [`error`, `always`],                     // each ?: arm on its own line → distinct branch coverage
      'brace-style': [`error`, `stroustrup`],                       // https://eslint.org/docs/latest/rules/brace-style#stroustrup
      'curly': `error`,
      'object-curly-newline': [`error`, { "consistent": true }],    // https://eslint.org/docs/latest/rules/object-curly-newline#consistent
      'local/custom-array-element-newline': [`error`, {             // replaces the built-in array-element-newline
        pairCommandArgs: true,                                      // pair spawn/exec flag+value (off → plain consistent)
      }],
      'local/arrow-multiline-block': `error`,                       // concise arrow body only for one-liners; else block + return
      'local/string-literals-max-len': [`error`, {                  // wrap+word-wrap an over-90-col test title in oneLine`…`
        importModule: `@directus/utils`,                            // oneLine lives in packages/utils (api + blackbox both dep on it)
      }],
      'function-call-argument-newline': [`error`, `consistent`],    // https://eslint.org/docs/latest/rules/function-call-argument-newline
      'function-paren-newline': [`error`, `multiline-arguments`],   // https://eslint.org/docs/latest/rules/function-paren-newline
      // 'padding-line-between-statements': [                          // https://eslint.org/docs/latest/rules/padding-line-between-statements#rule-details
      //   `error`,
      //   { blankLine: `always`, prev: `block-like`, next: `block-like` },
      // ],
      'comma-dangle': [`error`, `always-multiline`],                // https://eslint.org/docs/latest/rules/comma-dangle
      'newline-per-chained-call': [                                 // https://eslint.org/docs/latest/rules/newline-per-chained-call
        `error`, { "ignoreChainWithDepth": 2 },
      ],


      // QUALITY / SECURITY
      'no-var': `error`,
      'no-console': [ // disallow console.log only in production      https://eslint.org/docs/latest/rules/no-console
        process.env.NODE_ENV === `production` || process.env.GITHUB_ACTIONS === `true` ? `error` : `warn`,
        {
          allow: [`warn`, `error`, `info`, `debug`, `table`, `time`, `timeEnd`, `trace`, `dir`],
        },
      ],
      'no-unexpected-multiline': `error`,                           // https://eslint.org/docs/latest/rules/no-unexpected-multiline
      'no-undef': `off`,                                            // Safe to disable with TS and makes typeof auto-imported components broken https://eslint.org/docs/latest/rules/no-undef


      // Less work to patch
      'arrow-parens': [`error`, `always`],                          // https://eslint.org/docs/latest/rules/arrow-parens
      // commented: directus uses single quotes (prettier); quotes:backtick flips every string.
      // 'quotes': [`error`, `backtick`],                              // https://eslint.org/docs/latest/rules/quotes
      'no-duplicate-imports': `error`,
      'no-trailing-spaces': `error`,

      // interesting
      // https://eslint.org/docs/latest/rules/prefer-destructuring
    },
  },
  {
    files: [`**/*.vue`],
    rules: {
      "max-len": `off`,
      "vue/max-len": [`error`, {                                    // https://eslint.vuejs.org/rules/max-len.html
        code: 90,
        comments: 110,
        // "template": 9000,
        // ignoreTemplateLiterals off everywhere: a template literal must not exempt its line.
        // "ignoreTemplateLiterals": true,
        ignoreUrls: true,
        ignoreTrailingComments: true,
        // "ignoreStrings": true,
      }],
      // False positives since v10.0.1 upgrade
      // See for example https://github.com/eslint/eslint/issues/20486
      // or https://github.com/eslint/eslint/issues/20491
      'no-useless-assignment': `off`,
    },
  },
])

export default eslintBaseConfig
