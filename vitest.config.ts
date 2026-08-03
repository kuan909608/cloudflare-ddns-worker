import { defineConfig } from 'vitest/config';
export default defineConfig({ test:{ include:['tests/**/*.test.ts'], environment:'node', coverage:{ provider:'v8', reporter:['text','html','lcov'], include:['src/services/token-service.ts','src/services/ip-service.ts','src/utils/http.ts','src/utils/security.ts'], thresholds:{ lines:90,functions:90,branches:85,statements:90 } } } });
