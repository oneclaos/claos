import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node.js server files (CommonJS)
    "server/**",
    "launch.js",
    // Test files (different patterns)
    "__tests__/**",
    "__mocks__/**",
    "e2e/**",
  ]),
  // Project-wide rules
  {
    rules: {
      // Allow unused function params prefixed with underscore
      "@typescript-eslint/no-unused-vars": ["warn", { 
        argsIgnorePattern: "^_",
      }],
      // Allow empty interfaces (common for extending React props)
      "@typescript-eslint/no-empty-object-type": "off",
      // Allow setState in effects (common pattern for hydration)
      "react-hooks/set-state-in-effect": "off",
      // Allow preserve-manual-memoization warnings
      "react-hooks/preserve-manual-memoization": "off",
      // Allow immutability warnings  
      "react-hooks/immutability": "off",
      // Allow ref updates during render (stable callback pattern)
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
