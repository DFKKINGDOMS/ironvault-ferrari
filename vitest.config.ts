import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sharp/Tesseract callout rendering can legitimately exceed Vitest's
    // five-second default on shared CI workers even when the output is valid.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/store/migrate.ts']
    },
    environment: 'node'
  }
});
