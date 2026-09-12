import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "evals/holdout/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
