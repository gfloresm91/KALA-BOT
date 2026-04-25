const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = process.env.LOG_LEVEL || 'info';
const currentLevel = levels[configuredLevel] ?? levels.info;

function write(level, args) {
  if (levels[level] < currentLevel) {
    return;
  }

  const line = [new Date().toISOString(), level.toUpperCase(), '-', ...args];
  const target = level === 'error' ? console.error : console.log;
  target(...line);
}

export const logger = {
  debug: (...args) => write('debug', args),
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
};
