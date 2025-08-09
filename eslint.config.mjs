import prettierPlugin from "eslint-plugin-prettier"
import prettierConfig from "eslint-config-prettier"
import stylisticPlugin from "@stylistic/eslint-plugin"
import { tanstackConfig } from "@tanstack/config/eslint"

export default [
  ...tanstackConfig,
  { ignores: [`dist/`] },
  {
    plugins: {
      stylistic: stylisticPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      "prettier/prettier": `error`,
      "stylistic/quotes": [`error`, `backtick`],
      "pnpm/enforce-catalog": `off`,
      "pnpm/json-enforce-catalog": `off`,
      ...prettierConfig.rules,
    },
  },
  {
    files: [`**/*.ts`, `**/*.tsx`],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        `error`,
        { argsIgnorePattern: `^_`, varsIgnorePattern: `^_` },
      ],
      "@typescript-eslint/naming-convention": [
        `error`,
        {
          selector: `typeParameter`,
          format: [`PascalCase`],
          leadingUnderscore: `allow`,
        },
      ],
    },
  },
]
