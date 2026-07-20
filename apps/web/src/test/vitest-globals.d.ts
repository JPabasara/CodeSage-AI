// Makes Vitest's global APIs (describe / it / test / expect) known to
// TypeScript, matching `globals: true` in vitest.config.ts. Written as a
// reference file rather than a `types` array in tsconfig.json so it only ADDS
// these globals, instead of overriding TypeScript's default @types resolution.
/// <reference types="vitest/globals" />
