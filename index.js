import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import WebSocket from 'ws';

const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_USER_ACCESS_TOKEN,
  TWITCH_STREAMER_LOGIN,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_THREAD_ID,
  CHECK_DUPLICATES = 'true',

  // YouTube
  YOUTUBE_API_KEY,
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_POLL_INTERVAL_MS = '300000',
  YOUTUBE_NOTIFY_SHORTS = 'true',
} = process.env;

let twitchAccessToken = process.env.TWITCH_USER_ACCESS_TOKEN;
let twitchRefreshToken = process.env.TWITCH_REFRESH_TOKEN;

if (
  !TWITCH_CLIENT_ID ||
  !TWITCH_USER_ACCESS_TOKEN ||
  !TWITCH_STREAMER_LOGIN ||
  !twitchAccessToken ||
  !twitchRefreshToken ||
  !TELEGRAM_BOT_TOKEN ||
  !TELEGRAM_CHAT_ID ||
  !TELEGRAM_THREAD_ID
) {
  console.error('Faltan variables de Twitch/Telegram en .env');
  process.exit(1);
}

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const STATE_PATH = path.resolve(process.cwd(), 'bot-state.json');
const ENV_PATH = path.resolve(process.cwd(), '.env');

let streamerUser = null;
let lastNotifiedStreamId = null;
let ws = null;
let reconnectUrl = null;
let heartbeatTimer = null;

// YouTube state
let youtubeUploadsPlaylistId = null;
let lastNotifiedYoutubeVideoId = null;
let youtubePollTimer = null;

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      lastNotifiedStreamId: parsed.lastNotifiedStreamId || null,
      lastNotifiedYoutubeVideoId: parsed.lastNotifiedYoutubeVideoId || null,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        lastNotifiedStreamId: null,
        lastNotifiedYoutubeVideoId: null,
      };
    }

    throw err;
  }
}

async function writeState() {
  const data = {
    lastNotifiedStreamId,
    lastNotifiedYoutubeVideoId,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function setLastNotifiedStreamId(streamId) {
  lastNotifiedStreamId = streamId;
  await writeState();
}

async function setLastNotifiedYoutubeVideoId(videoId) {
  lastNotifiedYoutubeVideoId = videoId;
  await writeState();
}

async function updateEnvValue(key, value) {
  const envRaw = await fs.readFile(ENV_PATH, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const nextLine = `${key}=${value}`;

  let updated;
  if (pattern.test(envRaw)) {
    updated = envRaw.replace(pattern, nextLine);
  } else {
    updated = `${envRaw.trimEnd()}\n${nextLine}\n`;
  }

  await fs.writeFile(ENV_PATH, updated, 'utf8');
}

async function persistTwitchTokens(accessToken, refreshToken) {
  twitchAccessToken = accessToken;
  twitchRefreshToken = refreshToken;

  await updateEnvValue('TWITCH_USER_ACCESS_TOKEN', accessToken);
  await updateEnvValue('TWITCH_REFRESH_TOKEN', refreshToken);
}

async function validateTwitchAccessToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: {
      Authorization: `OAuth ${twitchAccessToken}`,
    },
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

async function refreshTwitchAccessToken() {
  log('Refrescando access token de Twitch...');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: twitchRefreshToken,
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`No se pudo refrescar token de Twitch: ${JSON.stringify(data)}`);
  }

  if (!data.access_token || !data.refresh_token) {
    throw new Error(`Respuesta inesperada al refrescar token: ${JSON.stringify(data)}`);
  }

  await persistTwitchTokens(data.access_token, data.refresh_token);

  log(`Token de Twitch refrescado. Expira en ${data.expires_in} segundos.`);
  return data;
}

async function ensureValidTwitchToken() {
  const validation = await validateTwitchAccessToken();

  if (!validation) {
    log('Token inválido o vencido. Intentando refresh...');
    await refreshTwitchAccessToken();
    return;
  }

  if (validation.client_id !== TWITCH_CLIENT_ID) {
    throw new Error(
      `El token pertenece a otro client_id. Esperado=${TWITCH_CLIENT_ID} recibido=${validation.client_id}`
    );
  }

  log(`Token válido para ${validation.login}. Expira en ${validation.expires_in} segundos.`);

  if (typeof validation.expires_in === 'number' && validation.expires_in < 600) {
    log('Token próximo a vencer. Refrescando preventivamente...');
    await refreshTwitchAccessToken();
  }
}

async function twitchFetch(path, options = {}, retryOnAuth = true) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    ...options,
    headers: {
      'Client-Id': TWITCH_CLIENT_ID,
      Authorization: `Bearer ${twitchAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 401 && retryOnAuth) {
    log('Twitch respondió 401. Intentando refresh automático...');
    await refreshTwitchAccessToken();
    return twitchFetch(path, options, false);
  }

  if (!res.ok) {
    throw new Error(`Twitch API ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function telegramSendMessage(text) {
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  };

  if (TELEGRAM_THREAD_ID) {
    payload.message_thread_id = Number(TELEGRAM_THREAD_ID);
  }

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(data)}`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function getStreamerUserByLogin(login) {
  const data = await twitchFetch(`/users?login=${encodeURIComponent(login)}`);

  if (!data?.data?.length) {
    throw new Error(`No encontré el usuario de Twitch: ${login}`);
  }

  return data.data[0];
}

async function getLiveStreamByUserId(userId) {
  const data = await twitchFetch(`/streams?user_id=${encodeURIComponent(userId)}`);
  return data?.data?.[0] || null;
}

async function subscribeToStreamOnline(sessionId, broadcasterUserId) {
  const body = {
    type: 'stream.online',
    version: '1',
    condition: {
      broadcaster_user_id: broadcasterUserId,
    },
    transport: {
      method: 'websocket',
      session_id: sessionId,
    },
  };

  const data = await twitchFetch('/eventsub/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return data;
}

async function sendLiveNotification(stream, user) {
  const title = escapeHtml(stream.title || 'Sin título');
  const url = `https://twitch.tv/${user.login}`;

  const fechaObj = new Date(stream.started_at);

  const fecha = `${String(fechaObj.getDate()).padStart(2, '0')}-${String(fechaObj.getMonth() + 1).padStart(2, '0')}-${fechaObj.getFullYear()}`;

  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  const mes = meses[fechaObj.getMonth()];
  const año = fechaObj.getFullYear();

  const tags = `#${año} #${mes} #`;

  const message = `
━━━━━━━━━━━━━━━━━━
🔴 <b>${escapeHtml(user.display_name)}</b> EN DIRECTO
━━━━━━━━━━━━━━━━━━

🔗 <b>Link:</b>
${url}

📌 <b>Título:</b>
${title}

📅 <b>Fecha:</b>
${fecha}

📝 <b>Info adicional:</b>
Comprimido

Directos a las 21 horas española

Spacedrum en mangaplus, denle cariño 😼
https://medibang.com/mpc/titles/3v2506130530262220027219089/

🌐 <b>Otras fuentes:</b>


━━━━━━━━━━━━━━━━━━
🏷️ <b>Tags:</b>
${tags}
━━━━━━━━━━━━━━━━━━
`.trim();

  await telegramSendMessage(message);
  log('Aviso de Twitch enviado a Telegram.');
}

async function handleStreamOnlineEvent(event) {
  log(`Evento stream.online recibido para ${event.broadcaster_user_login}`);

  const live = await getLiveStreamByUserId(event.broadcaster_user_id);

  if (!live) {
    log('El evento llegó, pero Get Streams aún no devuelve stream activo. Reintentando en 5s...');
    setTimeout(async () => {
      try {
        const retryLive = await getLiveStreamByUserId(event.broadcaster_user_id);
        if (!retryLive) {
          log('Sigue sin aparecer el stream activo. No se enviará aviso.');
          return;
        }

        if (CHECK_DUPLICATES === 'true' && lastNotifiedStreamId === retryLive.id) {
          log('Stream ya notificado anteriormente. Ignorando duplicado.');
          return;
        }

        await sendLiveNotification(retryLive, streamerUser);
        await setLastNotifiedStreamId(retryLive.id);
      } catch (err) {
        console.error('Error en reintento:', err);
      }
    }, 5000);

    return;
  }

  if (CHECK_DUPLICATES === 'true' && lastNotifiedStreamId === live.id) {
    log('Stream ya notificado anteriormente. Ignorando duplicado.');
    return;
  }

  await sendLiveNotification(live, streamerUser);
  await setLastNotifiedStreamId(live.id);
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function resetHeartbeat(timeoutMs = 45000) {
  clearHeartbeat();
  heartbeatTimer = setTimeout(() => {
    log('Timeout de keepalive. Reconectando WebSocket...');
    try {
      ws?.terminate();
    } catch {}
    connectWebSocket();
  }, timeoutMs);
}

function connectWebSocket() {
  clearHeartbeat();

  const targetUrl = reconnectUrl || EVENTSUB_WS_URL;
  reconnectUrl = null;

  log(`Conectando a EventSub WebSocket: ${targetUrl}`);

  ws = new WebSocket(targetUrl);

  ws.on('open', () => {
    log('WebSocket conectado.');
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const metadata = msg.metadata || {};
      const payload = msg.payload || {};
      const type = metadata.message_type;

      if (type === 'session_welcome') {
        const session = payload.session;

        log(`session_welcome recibido. session_id=${session.id}`);

        streamerUser = streamerUser || await getStreamerUserByLogin(TWITCH_STREAMER_LOGIN);

        const sub = await subscribeToStreamOnline(session.id, streamerUser.id);
        log('Suscripción creada:', JSON.stringify(sub, null, 2));

        const keepaliveSeconds = Number(session.keepalive_timeout_seconds || 30);
        resetHeartbeat((keepaliveSeconds + 15) * 1000);
        return;
      }

      if (type === 'session_keepalive') {
        log('Keepalive recibido.');
        resetHeartbeat();
        return;
      }

      if (type === 'session_reconnect') {
        const newUrl = payload?.session?.reconnect_url;
        log(`Twitch pidió reconexión. reconnect_url=${newUrl}`);

        reconnectUrl = newUrl || null;

        try {
          ws?.close();
        } catch {}

        return;
      }

      if (type === 'revocation') {
        console.error('Suscripción revocada:', JSON.stringify(msg, null, 2));
        return;
      }

      if (type === 'notification') {
        resetHeartbeat();

        if (payload?.subscription?.type === 'stream.online') {
          await handleStreamOnlineEvent(payload.event);
        } else {
          log('Notificación recibida de otro tipo:', payload?.subscription?.type);
        }

        return;
      }

      log('Mensaje no manejado:', JSON.stringify(msg, null, 2));
    } catch (err) {
      console.error('Error procesando mensaje WebSocket:', err);
    }
  });

  ws.on('close', (code, reason) => {
    clearHeartbeat();
    log(`WebSocket cerrado. code=${code} reason=${reason?.toString() || ''}`);

    if (code === 4007) {
      reconnectUrl = null;
    }

    setTimeout(() => {
      connectWebSocket();
    }, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

/* =========================
   YOUTUBE
========================= */

function isYouTubeEnabled() {
  return Boolean(YOUTUBE_API_KEY && YOUTUBE_CHANNEL_ID);
}

async function youtubeFetch(apiPath, params = {}) {
  const url = new URL(`${YOUTUBE_API}${apiPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set('key', YOUTUBE_API_KEY);

  const res = await fetch(url);
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`YouTube API ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function getYouTubeUploadsPlaylistId(channelId) {
  const data = await youtubeFetch('/channels', {
    part: 'contentDetails,snippet',
    id: channelId,
    maxResults: 1,
  });

  const channel = data?.items?.[0];
  if (!channel) {
    throw new Error(`No encontré el canal de YouTube: ${channelId}`);
  }

  return {
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    channelTitle: channel.snippet.title,
  };
}

async function getLatestYouTubeUpload(uploadsPlaylistId) {
  const data = await youtubeFetch('/playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: 1,
  });

  const item = data?.items?.[0];
  if (!item) {
    return null;
  }

  const videoId = item?.snippet?.resourceId?.videoId;
  if (!videoId) {
    return null;
  }

  return {
    videoId,
    title: item.snippet.title || 'Sin título',
    channelTitle: item.snippet.channelTitle || 'Canal',
    publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || null,
    description: item.snippet.description || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function looksLikeShort(video) {
  const title = String(video?.title || '').toLowerCase();
  const description = String(video?.description || '').toLowerCase();

  return title.includes('#shorts') || description.includes('#shorts');
}

async function sendYouTubeNotification(video) {
  const fechaObj = video.publishedAt ? new Date(video.publishedAt) : null;
  const fecha = fechaObj && !Number.isNaN(fechaObj.getTime())
    ? `${String(fechaObj.getDate()).padStart(2, '0')}-${String(fechaObj.getMonth() + 1).padStart(2, '0')}-${fechaObj.getFullYear()}`
    : 'N/D';

  const message = `
━━━━━━━━━━━━━━━━━━
📺 <b>${escapeHtml(video.channelTitle)}</b> SUBIÓ VIDEO NUEVO
━━━━━━━━━━━━━━━━━━

🔗 <b>Link:</b>
${video.url}

📌 <b>Título:</b>
${escapeHtml(video.title)}

📅 <b>Fecha:</b>
${fecha}
━━━━━━━━━━━━━━━━━━
`.trim();

  await telegramSendMessage(message);
  log('Aviso de YouTube enviado a Telegram.');
}

async function checkLatestYouTubeVideo({ initial = false } = {}) {
  if (!isYouTubeEnabled()) {
    return;
  }

  if (!youtubeUploadsPlaylistId) {
    const info = await getYouTubeUploadsPlaylistId(YOUTUBE_CHANNEL_ID);
    youtubeUploadsPlaylistId = info.uploadsPlaylistId;
    log(`YouTube monitoreando canal: ${info.channelTitle} | uploads playlist: ${youtubeUploadsPlaylistId}`);
  }

  const latestVideo = await getLatestYouTubeUpload(youtubeUploadsPlaylistId);

  if (!latestVideo) {
    log('YouTube: no se encontró video reciente.');
    return;
  }

  if (YOUTUBE_NOTIFY_SHORTS !== 'true' && looksLikeShort(latestVideo)) {
    log(`YouTube: el último contenido parece Short y YOUTUBE_NOTIFY_SHORTS=false. Video ${latestVideo.videoId}`);
    if (!lastNotifiedYoutubeVideoId) {
      await setLastNotifiedYoutubeVideoId(latestVideo.videoId);
    }
    return;
  }

  if (!lastNotifiedYoutubeVideoId) {
    await setLastNotifiedYoutubeVideoId(latestVideo.videoId);
    log(`YouTube: estado inicial fijado con video ${latestVideo.videoId}${initial ? ' (sin notificar)' : ''}`);
    return;
  }

  if (lastNotifiedYoutubeVideoId === latestVideo.videoId) {
    log(`YouTube: sin novedades. Último video sigue siendo ${latestVideo.videoId}`);
    return;
  }

  await sendYouTubeNotification(latestVideo);
  await setLastNotifiedYoutubeVideoId(latestVideo.videoId);
}

function scheduleYouTubePolling() {
  if (!isYouTubeEnabled()) {
    log('YouTube deshabilitado: faltan YOUTUBE_API_KEY o YOUTUBE_CHANNEL_ID');
    return;
  }

  const intervalMs = Number(YOUTUBE_POLL_INTERVAL_MS) || 300000;

  async function run() {
    try {
      await checkLatestYouTubeVideo();
    } catch (err) {
      console.error('Error revisando YouTube:', err);
    } finally {
      youtubePollTimer = setTimeout(run, intervalMs);
    }
  }

  youtubePollTimer = setTimeout(run, intervalMs);
  log(`YouTube polling activado cada ${intervalMs} ms.`);
}

async function main() {
  try {
    const savedState = await readState();
    lastNotifiedStreamId = savedState.lastNotifiedStreamId;
    lastNotifiedYoutubeVideoId = savedState.lastNotifiedYoutubeVideoId;

    log(
      `Estado cargado | Twitch streamId=${lastNotifiedStreamId || 'null'} | YouTube videoId=${lastNotifiedYoutubeVideoId || 'null'}`
    );

    await ensureValidTwitchToken();

    async function refreshLoop() {
      try {
        await ensureValidTwitchToken();
      } catch (err) {
        console.error('Error en refreshLoop:', err);
      }

      setTimeout(refreshLoop, 50 * 60 * 1000);
    }

    setTimeout(refreshLoop, 50 * 60 * 1000);

    streamerUser = await getStreamerUserByLogin(TWITCH_STREAMER_LOGIN);
    log(`Monitoreando Twitch a ${streamerUser.display_name} (${streamerUser.login}) [${streamerUser.id}]`);

    connectWebSocket();

    setTimeout(async () => {
      try {
        const liveNow = await getLiveStreamByUserId(streamerUser.id);

        if (liveNow) {
          log('Comprobación inicial: el streamer ya estaba en directo.');

          if (CHECK_DUPLICATES !== 'true' || lastNotifiedStreamId !== liveNow.id) {
            await sendLiveNotification(liveNow, streamerUser);
            await setLastNotifiedStreamId(liveNow.id);
          }
        } else {
          log('Comprobación inicial: el streamer no estaba en directo.');
        }
      } catch (err) {
        console.error('Error en comprobación inicial:', err);
      }
    }, 2000);

    if (isYouTubeEnabled()) {
      try {
        await checkLatestYouTubeVideo({ initial: true });
        scheduleYouTubePolling();
      } catch (err) {
        console.error('Error iniciando monitoreo de YouTube:', err);
      }
    } else {
      log('YouTube no configurado. Si quieres activarlo, agrega YOUTUBE_API_KEY y YOUTUBE_CHANNEL_ID al .env');
    }
  } catch (err) {
    console.error('Error al iniciar:', err);
    process.exit(1);
  }
}

main();