import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Imported first by index.ts: loads <project>/.env (if present) before any module reads process.env.
// Variables already set in the real environment win over the file.
const file = fileURLToPath(new URL('../.env', import.meta.url));
if (fs.existsSync(file)) process.loadEnvFile(file);
