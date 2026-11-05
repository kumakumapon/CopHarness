/** Load .env, .env.local etc. the same way Next.js does (for the CLI). */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), false, { info: () => {}, error: (...args: unknown[]) => console.error(...args) });
