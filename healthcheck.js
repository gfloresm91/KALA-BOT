import 'dotenv/config';
import { config } from './src/config.js';
import { checkHealth } from './src/health.js';

try {
  const health = await checkHealth(config.paths.health, config.health.maxAgeMs);
  console.log(`ok pid=${health.pid} updatedAt=${health.updatedAt}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
