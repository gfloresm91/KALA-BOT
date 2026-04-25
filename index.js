import 'dotenv/config';
import { config, isYouTubeEnabled, validateConfig } from './src/config.js';
import { HealthReporter } from './src/health.js';
import { logger } from './src/logger.js';
import { StateStore } from './src/state.js';
import { TelegramClient } from './src/telegram.js';
import { TemplateRenderer } from './src/templates.js';
import { TwitchClient, TwitchMonitor } from './src/twitch.js';
import { YouTubeMonitor } from './src/youtube.js';

let shuttingDown = false;
let telegram = null;
let twitchMonitor = null;
let youtubeMonitor = null;
let healthReporter = null;

async function notifyError(err, context) {
  logger.error(context, err);

  if (!telegram || !config.telegram.notifyErrors) {
    return;
  }

  try {
    await telegram.sendError(err, context);
  } catch (notifyErr) {
    logger.error('No se pudo enviar notificación de error a Telegram:', notifyErr);
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`${signal} recibido. Cerrando bot...`);

  healthReporter?.stop();
  youtubeMonitor?.stop();

  try {
    await twitchMonitor?.stop();
  } catch (err) {
    logger.error('Error cerrando Twitch monitor:', err);
  }

  if (telegram && config.telegram.notifyLifecycle) {
    try {
      await telegram.sendLifecycle(`Bot detenido por ${signal}.`);
    } catch (err) {
      logger.error('No se pudo enviar aviso de apagado:', err);
    }
  }

  logger.info('Bot cerrado correctamente.');
  process.exit(0);
}

function bindProcessHandlers() {
  process.once('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
      logger.error('Error cerrando bot:', err);
      process.exit(1);
    });
  });

  process.once('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
      logger.error('Error cerrando bot:', err);
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (err) => {
    notifyError(err, 'Unhandled rejection').catch(() => {});
  });

  process.on('uncaughtException', (err) => {
    notifyError(err, 'Uncaught exception').finally(() => {
      process.exit(1);
    });
  });
}

async function main() {
  try {
    validateConfig();

    bindProcessHandlers();

    const stateStore = new StateStore(config.paths.state);
    await stateStore.load();
    logger.info('Estado cargado.');

    telegram = new TelegramClient(config.telegram);
    const renderer = new TemplateRenderer(config.paths.templates);

    healthReporter = new HealthReporter(config.paths.health, logger);
    healthReporter.start(config.health.intervalMs);

    if (config.telegram.notifyLifecycle) {
      await telegram.sendLifecycle('Bot iniciado.');
    }

    const twitchClient = new TwitchClient(config.twitch, config.paths.env, logger);
    twitchMonitor = new TwitchMonitor({
      twitchClient,
      config: config.twitch,
      stateStore,
      telegram,
      renderer,
      logger,
    });
    await twitchMonitor.start();

    if (isYouTubeEnabled()) {
      youtubeMonitor = new YouTubeMonitor({
        config: config.youtube,
        stateStore,
        telegram,
        renderer,
        logger,
      });
      await youtubeMonitor.start({ initial: true });
    } else {
      logger.info('YouTube no configurado. Si quieres activarlo, agrega YOUTUBE_API_KEY y YOUTUBE_CHANNEL_ID al .env');
    }
  } catch (err) {
    await notifyError(err, 'Error al iniciar');
    process.exit(1);
  }
}

main();
