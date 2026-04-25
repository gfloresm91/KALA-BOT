import fs from 'fs/promises';
import { writeFileAtomic } from './utils.js';

function updateEnvContent(envRaw, updates) {
  let updated = envRaw;

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    const nextLine = `${key}=${value}`;

    if (pattern.test(updated)) {
      updated = updated.replace(pattern, nextLine);
    } else {
      updated = `${updated.trimEnd()}\n${nextLine}\n`;
    }
  }

  return updated;
}

export async function updateEnvValues(envPath, updates) {
  const envRaw = await fs.readFile(envPath, 'utf8');
  const updated = updateEnvContent(envRaw, updates);

  await writeFileAtomic(envPath, updated);
}
