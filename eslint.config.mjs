import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import reactPlugin from "eslint-plugin-react"
import prettierPlugin from "eslint-plugin-prettier"
import prettierConfig from "eslint-config-prettier"
import globals from "globals"
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
      ...prettierConfig.rules,
    },
  },
]
