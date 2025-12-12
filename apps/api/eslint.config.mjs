import baseConfig from "@hono/eslint-config";
import tseslint from "typescript-eslint";

export default tseslint.config(...baseConfig, {
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // Make most rules warnings or off - keep it lenient
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-empty-interface": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-unused-vars": "off", // Use TypeScript version instead
    "no-empty": "off",
    "no-undef": "off", // TypeScript handles this
  },
});
