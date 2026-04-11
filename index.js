import 'dotenv/config';
import WebSocket from 'ws';

const {
  TWITCH_CLIENT_ID,
  TWITCH_USER_ACCESS_TOKEN,
  TWITCH_STREAMER_LOGIN,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_THREAD_ID,
  CHECK_DUPLICATES = 'true',
} = process.env;

if (
  !TWITCH_CLIENT_ID ||
  !TWITCH_USER_ACCESS_TOKEN ||
  !TWITCH_STREAMER_LOGIN ||
  !TELEGRAM_BOT_TOKEN ||
  !TELEGRAM_CHAT_ID ||
  !TELEGRAM_THREAD_ID
) {
  console.error('Faltan variables en .env');
  process.exit(1);
}

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

let streamerUser = null;
let lastNotifiedStreamId = null;
let ws = null;
let reconnectUrl = null;
let heartbeatTimer = null;

function log(...args) {
  console.log(new Date().toISOString(), '-', ...args);
}

async function twitchFetch(path, options = {}) {
  const res = await fetch(`${TWITCH_API}${path}`, {
    ...options,
    headers: {
      'Client-Id': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${TWITCH_USER_ACCESS_TOKEN}`,
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

  if (!res.ok) {
    throw new Error(`Twitch API ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function telegramSendMessage(text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      message_thread_id: Number(TELEGRAM_THREAD_ID),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
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
  const game = escapeHtml(stream.game_name || 'Sin categoría');
  const viewers = typeof stream.viewer_count === 'number'
    ? stream.viewer_count.toLocaleString('es-CL')
    : 'N/D';
  const startedAt = stream.started_at ? new Date(stream.started_at) : null;
  const startedText = startedAt
    ? startedAt.toLocaleString('es-CL', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'N/D';

  const url = `https://twitch.tv/${user.login}`;

  const fechaObj = new Date(stream.started_at);

  const fecha = `${String(fechaObj.getDate()).padStart(2, '0')}-${String(fechaObj.getMonth() + 1).padStart(2, '0')}-${fechaObj.getFullYear()}`;

  const meses = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
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

Seguimos con directos a 720p

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
  log('Aviso enviado a Telegram.');
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
        lastNotifiedStreamId = retryLive.id;
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
  lastNotifiedStreamId = live.id;
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
        reconnectUrl = null;

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
        reconnectUrl = newUrl || EVENTSUB_WS_URL;

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

    setTimeout(() => {
      connectWebSocket();
    }, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
}

// async function main() {
//   try {
//     streamerUser = await getStreamerUserByLogin(TWITCH_STREAMER_LOGIN);
//     log(`Monitoreando a ${streamerUser.display_name} (${streamerUser.login}) [${streamerUser.id}]`);

//     // Comprobación inicial: por si ya estaba en directo antes de arrancar el bot
//     const liveNow = await getLiveStreamByUserId(streamerUser.id);

//     if (liveNow) {
//       log('El streamer ya estaba en directo al iniciar. Enviando aviso inicial...');

//       if (CHECK_DUPLICATES !== 'true' || lastNotifiedStreamId !== liveNow.id) {
//         await sendLiveNotification(liveNow, streamerUser);
//         lastNotifiedStreamId = liveNow.id;
//       }
//     } else {
//       log('El streamer no estaba en directo al iniciar.');
//     }

//     connectWebSocket();
//   } catch (err) {
//     console.error('Error al iniciar:', err);
//     process.exit(1);
//   }
// }

async function main() {
  try {
    streamerUser = await getStreamerUserByLogin(TWITCH_STREAMER_LOGIN);
    log(`Monitoreando a ${streamerUser.display_name} (${streamerUser.login}) [${streamerUser.id}]`);

    connectWebSocket();

    setTimeout(async () => {
      try {
        const liveNow = await getLiveStreamByUserId(streamerUser.id);

        if (liveNow) {
          log('Comprobación inicial: el streamer ya estaba en directo.');

          if (CHECK_DUPLICATES !== 'true' || lastNotifiedStreamId !== liveNow.id) {
            await sendLiveNotification(liveNow, streamerUser);
            lastNotifiedStreamId = liveNow.id;
          }
        } else {
          log('Comprobación inicial: el streamer no estaba en directo.');
        }
      } catch (err) {
        console.error('Error en comprobación inicial:', err);
      }
    }, 2000);
  } catch (err) {
    console.error('Error al iniciar:', err);
    process.exit(1);
  }
}

main();