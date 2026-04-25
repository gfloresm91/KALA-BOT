import fs from 'fs/promises';
import { writeFileAtomic } from './utils.js';

export class HealthReporter {
  constructor(filePath, logger) {
    this.filePath = filePath;
    this.logger = logger;
    this.timer = null;
  }

  async write(status = 'ok') {
    await writeFileAtomic(this.filePath, JSON.stringify({
      status,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  }

  start(intervalMs) {
    const run = async () => {
      try {
        await this.write();
      } catch (err) {
        this.logger.error('No se pudo escribir healthcheck:', err);
      } finally {
        this.timer = setTimeout(run, intervalMs);
      }
    };

    run();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export async function checkHealth(filePath, maxAgeMs) {
  const raw = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  const updatedAt = new Date(data.updatedAt).getTime();

  if (data.status !== 'ok') {
    throw new Error(`Estado no saludable: ${data.status}`);
  }

  if (Number.isNaN(updatedAt)) {
    throw new Error('Healthcheck sin updatedAt válido');
  }

  const ageMs = Date.now() - updatedAt;
  if (ageMs > maxAgeMs) {
    throw new Error(`Healthcheck vencido: ${ageMs} ms`);
  }

  return data;
}
