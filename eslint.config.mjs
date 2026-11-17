import { defineConfig } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
export default defineConfig([
  ...next,
  {
    ignores: [
      "src/generated/**",
      "outputs/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
]);
