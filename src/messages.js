import { escapeHtml, formatDate, formatDuration } from './utils.js';

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const TWITCH_LIVE_TEMPLATE = `
━━━━━━━━━━━━━━━━━━
🔴 <b>{{DISPLAY_NAME}}</b> EN DIRECTO
━━━━━━━━━━━━━━━━━━

🔗 <b>Link:</b>
{{URL}}

📌 <b>Título:</b>
{{TITLE}}

📅 <b>Fecha:</b>
{{DATE}}

📝 <b>Info adicional:</b>
{{EXTRA_INFO}}

🌐 <b>Otras fuentes:</b>
{{OTHER_SOURCES}}

━━━━━━━━━━━━━━━━━━
🏷️ <b>Tags:</b>
{{TAGS}}
━━━━━━━━━━━━━━━━━━
`.trim();

export const TWITCH_OFFLINE_TEMPLATE = `
━━━━━━━━━━━━━━━━━━
⚫ <b>{{DISPLAY_NAME}}</b> TERMINÓ DIRECTO
━━━━━━━━━━━━━━━━━━

🔗 <b>Canal:</b>
{{URL}}

⏱️ <b>Duración aproximada:</b>
{{DURATION}}
━━━━━━━━━━━━━━━━━━
`.trim();

export const TWITCH_SCHEDULE_TEMPLATE = `
━━━━━━━━━━━━━━━━━━
🗓️ <b>{{DISPLAY_NAME}}</b> TIENE DIRECTO PROGRAMADO
━━━━━━━━━━━━━━━━━━

🔗 <b>Canal:</b>
{{URL}}

📌 <b>Título:</b>
{{TITLE}}

🕒 <b>Inicio:</b>
{{START_TIME}}
━━━━━━━━━━━━━━━━━━
`.trim();

export const YOUTUBE_VIDEO_TEMPLATE = `
━━━━━━━━━━━━━━━━━━
📺 <b>{{CHANNEL_TITLE}}</b> SUBIÓ VIDEO NUEVO
━━━━━━━━━━━━━━━━━━

🔗 <b>Link:</b>
{{URL}}

📌 <b>Título:</b>
{{TITLE}}

📅 <b>Fecha:</b>
{{DATE}}
━━━━━━━━━━━━━━━━━━
`.trim();

export const YOUTUBE_SHORT_TEMPLATE = `
━━━━━━━━━━━━━━━━━━
▶️ <b>{{CHANNEL_TITLE}}</b> SUBIÓ SHORT NUEVO
━━━━━━━━━━━━━━━━━━

🔗 <b>Link:</b>
{{URL}}

📌 <b>Título:</b>
{{TITLE}}

📅 <b>Fecha:</b>
{{DATE}}
━━━━━━━━━━━━━━━━━━
`.trim();

export async function renderTwitchLive(renderer, stream, user, options) {
  const startedAt = new Date(stream.started_at);
  const month = MONTHS[startedAt.getMonth()] || '';
  const year = startedAt.getFullYear();

  return renderer.render('twitch-live.txt', {
    DISPLAY_NAME: escapeHtml(user.display_name),
    URL: `https://twitch.tv/${user.login}`,
    TITLE: escapeHtml(stream.title || 'Sin título'),
    DATE: formatDate(startedAt),
    EXTRA_INFO: escapeHtml(options.extraInfo),
    OTHER_SOURCES: escapeHtml(options.otherSources),
    TAGS: `#${year} #${month} #`,
  }, TWITCH_LIVE_TEMPLATE);
}

export async function renderTwitchOffline(renderer, user, startedAt, endedAt = new Date()) {
  return renderer.render('twitch-offline.txt', {
    DISPLAY_NAME: escapeHtml(user.display_name),
    URL: `https://twitch.tv/${user.login}`,
    DURATION: formatDuration(new Date(endedAt).getTime() - new Date(startedAt).getTime()),
  }, TWITCH_OFFLINE_TEMPLATE);
}

export async function renderTwitchSchedule(renderer, user, segment) {
  return renderer.render('twitch-schedule.txt', {
    DISPLAY_NAME: escapeHtml(user.display_name),
    URL: `https://twitch.tv/${user.login}`,
    TITLE: escapeHtml(segment.title || 'Directo programado'),
    START_TIME: escapeHtml(new Date(segment.start_time).toLocaleString('es-ES')),
  }, TWITCH_SCHEDULE_TEMPLATE);
}

export async function renderYouTubeVideo(renderer, video) {
  const contentType = video.contentType || 'video';
  const contentTypeLabel = contentType === 'short' ? 'Short' : 'Video';
  const templateName = contentType === 'short' ? 'youtube-short.txt' : 'youtube-video.txt';
  const fallback = contentType === 'short' ? YOUTUBE_SHORT_TEMPLATE : YOUTUBE_VIDEO_TEMPLATE;

  return renderer.render(templateName, {
    CHANNEL_TITLE: escapeHtml(video.channelTitle),
    CONTENT_TYPE: contentType,
    CONTENT_TYPE_LABEL: contentTypeLabel,
    URL: video.url,
    TITLE: escapeHtml(video.title),
    DATE: formatDate(video.publishedAt),
  }, fallback);
}
