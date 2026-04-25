import path from 'path';
import { bool, list } from './utils.js';

const twitchLogins = list(process.env.TWITCH_STREAMER_LOGINS || process.env.TWITCH_STREAMER_LOGIN);
const youtubeChannelIds = list(process.env.YOUTUBE_CHANNEL_IDS || process.env.YOUTUBE_CHANNEL_ID);

function multiline(value) {
  return String(value || '').replaceAll('\\n', '\n');
}

export const config = {
  paths: {
    state: path.resolve(process.cwd(), 'bot-state.json'),
    health: path.resolve(process.cwd(), 'bot-health.json'),
    env: path.resolve(process.cwd(), '.env'),
    templates: path.resolve(process.cwd(), 'templates'),
  },
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
    accessToken: process.env.TWITCH_USER_ACCESS_TOKEN,
    refreshToken: process.env.TWITCH_REFRESH_TOKEN,
    streamerLogins: twitchLogins,
    checkDuplicates: bool(process.env.CHECK_DUPLICATES, true),
    extraInfo: process.env.TWITCH_EXTRA_INFO ? multiline(process.env.TWITCH_EXTRA_INFO) : [
      'Comprimido',
      '',
      'Directos a las 21 horas española',
      '',
      'Spacedrum en mangaplus, denle cariño 😼',
      'https://medibang.com/mpc/titles/3v2506130530262220027219089/',
    ].join('\n'),
    otherSources: multiline(process.env.TWITCH_OTHER_SOURCES),
    notifyOnStartupLive: bool(process.env.TWITCH_NOTIFY_ON_STARTUP, true),
    scheduleReminders: bool(process.env.TWITCH_SCHEDULE_REMINDERS, false),
    schedulePollIntervalMs: Number(process.env.TWITCH_SCHEDULE_POLL_INTERVAL_MS || 900000),
    scheduleReminderMinutes: Number(process.env.TWITCH_SCHEDULE_REMINDER_MINUTES || 60),
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY,
    channelIds: youtubeChannelIds,
    pollIntervalMs: Number(process.env.YOUTUBE_POLL_INTERVAL_MS || 300000),
    notifyShorts: bool(process.env.YOUTUBE_NOTIFY_SHORTS, true),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    threadId: process.env.TELEGRAM_THREAD_ID,
    notifyLifecycle: bool(process.env.TELEGRAM_NOTIFY_LIFECYCLE, false),
    notifyErrors: bool(process.env.TELEGRAM_NOTIFY_ERRORS, true),
  },
  health: {
    intervalMs: Number(process.env.HEALTH_WRITE_INTERVAL_MS || 30000),
    maxAgeMs: Number(process.env.HEALTH_MAX_AGE_MS || 120000),
  },
};

export function validateConfig() {
  const missing = [];

  if (!config.twitch.clientId) missing.push('TWITCH_CLIENT_ID');
  if (!config.twitch.clientSecret) missing.push('TWITCH_CLIENT_SECRET');
  if (!config.twitch.accessToken) missing.push('TWITCH_USER_ACCESS_TOKEN');
  if (!config.twitch.refreshToken) missing.push('TWITCH_REFRESH_TOKEN');
  if (!config.twitch.streamerLogins.length) missing.push('TWITCH_STREAMER_LOGIN o TWITCH_STREAMER_LOGINS');
  if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.chatId) missing.push('TELEGRAM_CHAT_ID');
  if (!config.telegram.threadId) missing.push('TELEGRAM_THREAD_ID');

  if (missing.length) {
    throw new Error(`Faltan variables en .env: ${missing.join(', ')}`);
  }
}

export function isYouTubeEnabled() {
  return Boolean(config.youtube.apiKey && config.youtube.channelIds.length);
}
