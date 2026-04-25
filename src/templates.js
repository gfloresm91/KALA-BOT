import fs from 'fs/promises';
import path from 'path';

export class TemplateRenderer {
  constructor(templateDir) {
    this.templateDir = templateDir;
    this.cache = new Map();
  }

  async render(name, values, fallback) {
    const template = await this.load(name, fallback);

    return template.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => values[key] ?? '');
  }

  async load(name, fallback) {
    if (this.cache.has(name)) {
      return this.cache.get(name);
    }

    try {
      const template = await fs.readFile(path.join(this.templateDir, name), 'utf8');
      this.cache.set(name, template);
      return template;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }

      this.cache.set(name, fallback);
      return fallback;
    }
  }
}
