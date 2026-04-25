import WebSocket from 'ws';
import { updateEnvValues } from './env-store.js';
import {
  renderTwitchLive,
  renderTwitchOffline,
  renderTwitchSchedule,
} from './messages.js';

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

export class TwitchClient {
  constructor(config, envPath, logger) {
    this.config = config;
    this.envPath = envPath;
    this.logger = logger;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  async validateAccessToken() {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        Authorization: `OAuth ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    return res.json();
  }

  async refreshAccessToken() {
    this.logger.info('Refrescando access token de Twitch...');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
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

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    await updateEnvValues(this.envPath, {
      TWITCH_USER_ACCESS_TOKEN: data.access_token,
      TWITCH_REFRESH_TOKEN: data.refresh_token,
    });

    this.logger.info(`Token de Twitch refrescado. Expira en ${data.expires_in} segundos.`);
    return data;
  }

  async ensureValidToken() {
    const validation = await this.validateAccessToken();

    if (!validation) {
      this.logger.info('Token inválido o vencido. Intentando refresh...');
      await this.refreshAccessToken();
      return;
    }

    if (validation.client_id !== this.config.clientId) {
      throw new Error(
        `El token pertenece a otro client_id. Esperado=${this.config.clientId} recibido=${validation.client_id}`
      );
    }

    this.logger.info(`Token válido para ${validation.login}. Expira en ${validation.expires_in} segundos.`);

    if (typeof validation.expires_in === 'number' && validation.expires_in < 600) {
      this.logger.info('Token próximo a vencer. Refrescando preventivamente...');
      await this.refreshAccessToken();
    }
  }

  async fetch(apiPath, options = {}, retryOnAuth = true) {
    const res = await fetch(`${TWITCH_API}${apiPath}`, {
      ...options,
      headers: {
        'Client-Id': this.config.clientId,
        Authorization: `Bearer ${this.accessToken}`,
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
      this.logger.info('Twitch respondió 401. Intentando refresh automático...');
      await this.refreshAccessToken();
      return this.fetch(apiPath, options, false);
    }

    if (!res.ok) {
      throw new Error(`Twitch API ${res.status}: ${JSON.stringify(data)}`);
    }

    return data;
  }

  async getUsersByLogin(logins) {
    const params = logins
      .map((login) => `login=${encodeURIComponent(login)}`)
      .join('&');
    const data = await this.fetch(`/users?${params}`);
    return data?.data || [];
  }

  async getLiveStreamByUserId(userId) {
    const data = await this.fetch(`/streams?user_id=${encodeURIComponent(userId)}`);
    return data?.data?.[0] || null;
  }

  async subscribe(sessionId, type, broadcasterUserId) {
    const body = {
      type,
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterUserId,
      },
      transport: {
        method: 'websocket',
        session_id: sessionId,
      },
    };

    return this.fetch('/eventsub/subscriptions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getSchedule(userId) {
    const data = await this.fetch(`/schedule?broadcaster_id=${encodeURIComponent(userId)}&first=1`);
    return data?.data?.segments?.[0] || null;
  }
}

export class TwitchMonitor {
  constructor({ twitchClient, config, stateStore, telegram, renderer, logger }) {
    this.client = twitchClient;
    this.config = config;
    this.stateStore = stateStore;
    this.telegram = telegram;
    this.renderer = renderer;
    this.logger = logger;
    this.usersById = new Map();
    this.usersByLogin = new Map();
    this.ws = null;
    this.reconnectUrl = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.initialLiveCheckTimer = null;
    this.scheduleTimer = null;
    this.shuttingDown = false;
  }

  async start() {
    await this.client.ensureValidToken();
    this.scheduleRefreshLoop();

    const users = await this.client.getUsersByLogin(this.config.streamerLogins);
    const foundLogins = new Set(users.map((user) => user.login.toLowerCase()));
    const missing = this.config.streamerLogins.filter((login) => !foundLogins.has(login.toLowerCase()));

    if (missing.length) {
      throw new Error(`No encontré usuarios de Twitch: ${missing.join(', ')}`);
    }

    for (const user of users) {
      this.usersById.set(user.id, user);
      this.usersByLogin.set(user.login, user);
      this.logger.info(`Monitoreando Twitch a ${user.display_name} (${user.login}) [${user.id}]`);
    }

    this.connectWebSocket();
    this.scheduleInitialLiveCheck();

    if (this.config.scheduleReminders) {
      this.scheduleSchedulePolling();
    }
  }

  scheduleRefreshLoop() {
    const run = async () => {
      try {
        await this.client.ensureValidToken();
      } catch (err) {
        this.logger.error('Error en refreshLoop:', err);
      }

      if (!this.shuttingDown) {
        this.refreshTimer = setTimeout(run, 50 * 60 * 1000);
      }
    };

    this.refreshTimer = setTimeout(run, 50 * 60 * 1000);
  }

  scheduleInitialLiveCheck() {
    this.initialLiveCheckTimer = setTimeout(async () => {
      for (const user of this.usersById.values()) {
        try {
          const liveNow = await this.client.getLiveStreamByUserId(user.id);

          if (!liveNow) {
            this.logger.info(`Comprobación inicial: ${user.login} no estaba en directo.`);
            continue;
          }

          this.logger.info(`Comprobación inicial: ${user.login} ya estaba en directo.`);

          if (!this.config.notifyOnStartupLive) {
            const state = this.stateStore.getTwitch(user.login);
            state.lastNotifiedStreamId = liveNow.id;
            state.lastLiveStartedAt = liveNow.started_at;
            state.lastLiveEndedAt = null;
            await this.stateStore.save();
            this.logger.info(`TWITCH_NOTIFY_ON_STARTUP=false. Estado inicial fijado para ${user.login} sin notificar.`);
            continue;
          }

          await this.notifyLive(liveNow, user);
        } catch (err) {
          this.logger.error(`Error en comprobación inicial para ${user.login}:`, err);
        }
      }
    }, 2000);
  }

  async notifyLive(stream, user) {
    const state = this.stateStore.getTwitch(user.login);

    if (this.config.checkDuplicates && state.lastNotifiedStreamId === stream.id) {
      this.logger.info(`Stream ${stream.id} de ${user.login} ya fue notificado. Ignorando duplicado.`);
      return;
    }

    const message = await renderTwitchLive(this.renderer, stream, user, {
      extraInfo: this.config.extraInfo,
      otherSources: this.config.otherSources,
    });

    await this.telegram.sendMessage(message);

    state.lastNotifiedStreamId = stream.id;
    state.lastLiveStartedAt = stream.started_at;
    state.lastLiveEndedAt = null;
    await this.stateStore.save();
    this.logger.info(`Aviso de Twitch live enviado para ${user.login}.`);
  }

  async notifyOffline(user) {
    const state = this.stateStore.getTwitch(user.login);

    if (state.lastLiveEndedAt && state.lastLiveEndedAt > state.lastLiveStartedAt) {
      this.logger.info(`Offline de ${user.login} ya fue notificado. Ignorando duplicado.`);
      return;
    }

    const startedAt = state.lastLiveStartedAt;
    if (!startedAt) {
      this.logger.info(`Offline recibido para ${user.login}, pero no hay inicio registrado.`);
      return;
    }

    const endedAt = new Date().toISOString();
    const message = await renderTwitchOffline(this.renderer, user, startedAt, endedAt);
    await this.telegram.sendMessage(message);

    state.lastLiveEndedAt = endedAt;
    await this.stateStore.save();
    this.logger.info(`Aviso de Twitch offline enviado para ${user.login}.`);
  }

  async handleStreamOnlineEvent(event) {
    this.logger.info(`Evento stream.online recibido para ${event.broadcaster_user_login}`);

    const user = this.usersById.get(event.broadcaster_user_id);
    if (!user) {
      this.logger.warn(`Usuario no registrado para broadcaster_user_id=${event.broadcaster_user_id}`);
      return;
    }

    const live = await this.client.getLiveStreamByUserId(event.broadcaster_user_id);

    if (live) {
      await this.notifyLive(live, user);
      return;
    }

    this.logger.info('El evento llegó, pero Get Streams aún no devuelve stream activo. Reintentando en 5s...');
    setTimeout(async () => {
      try {
        const retryLive = await this.client.getLiveStreamByUserId(event.broadcaster_user_id);
        if (!retryLive) {
          this.logger.info('Sigue sin aparecer el stream activo. No se enviará aviso.');
          return;
        }

        await this.notifyLive(retryLive, user);
      } catch (err) {
        this.logger.error('Error en reintento:', err);
      }
    }, 5000);
  }

  async handleStreamOfflineEvent(event) {
    this.logger.info(`Evento stream.offline recibido para ${event.broadcaster_user_login}`);
    const user = this.usersById.get(event.broadcaster_user_id);

    if (!user) {
      this.logger.warn(`Usuario no registrado para broadcaster_user_id=${event.broadcaster_user_id}`);
      return;
    }

    await this.notifyOffline(user);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  resetHeartbeat(timeoutMs = 45000) {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn('Timeout de keepalive. Reconectando WebSocket...');
      try {
        this.ws?.terminate();
      } catch {}
    }, timeoutMs);
  }

  scheduleReconnect(delayMs = 5000) {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delayMs);
  }

  connectWebSocket() {
    if (this.shuttingDown) {
      return;
    }

    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const targetUrl = this.reconnectUrl || EVENTSUB_WS_URL;
    this.reconnectUrl = null;

    this.logger.info(`Conectando a EventSub WebSocket: ${targetUrl}`);
    this.ws = new WebSocket(targetUrl);

    this.ws.on('open', () => {
      this.logger.info('WebSocket conectado.');
    });

    this.ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const metadata = msg.metadata || {};
        const payload = msg.payload || {};
        const type = metadata.message_type;

        if (type === 'session_welcome') {
          const session = payload.session;
          this.logger.info(`session_welcome recibido. session_id=${session.id}`);

          for (const user of this.usersById.values()) {
            const onlineSub = await this.client.subscribe(session.id, 'stream.online', user.id);
            const offlineSub = await this.client.subscribe(session.id, 'stream.offline', user.id);
            this.logger.debug('Suscripción online creada:', JSON.stringify(onlineSub));
            this.logger.debug('Suscripción offline creada:', JSON.stringify(offlineSub));
          }

          const keepaliveSeconds = Number(session.keepalive_timeout_seconds || 30);
          this.resetHeartbeat((keepaliveSeconds + 15) * 1000);
          return;
        }

        if (type === 'session_keepalive') {
          this.logger.debug('Keepalive recibido.');
          this.resetHeartbeat();
          return;
        }

        if (type === 'session_reconnect') {
          const newUrl = payload?.session?.reconnect_url;
          this.logger.info(`Twitch pidió reconexión. reconnect_url=${newUrl}`);
          this.reconnectUrl = newUrl || null;

          try {
            this.ws?.close();
          } catch {}

          return;
        }

        if (type === 'revocation') {
          this.logger.error('Suscripción revocada:', JSON.stringify(msg, null, 2));
          return;
        }

        if (type === 'notification') {
          this.resetHeartbeat();

          if (payload?.subscription?.type === 'stream.online') {
            await this.handleStreamOnlineEvent(payload.event);
          } else if (payload?.subscription?.type === 'stream.offline') {
            await this.handleStreamOfflineEvent(payload.event);
          } else {
            this.logger.info('Notificación recibida de otro tipo:', payload?.subscription?.type);
          }

          return;
        }

        this.logger.debug('Mensaje no manejado:', JSON.stringify(msg, null, 2));
      } catch (err) {
        this.logger.error('Error procesando mensaje WebSocket:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.clearHeartbeat();
      this.logger.info(`WebSocket cerrado. code=${code} reason=${reason?.toString() || ''}`);

      if (code === 4007) {
        this.reconnectUrl = null;
      }

      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.logger.error('WebSocket error:', err);
    });
  }

  scheduleSchedulePolling() {
    const run = async () => {
      if (this.shuttingDown) {
        return;
      }

      for (const user of this.usersById.values()) {
        try {
          await this.checkSchedule(user);
        } catch (err) {
          this.logger.error(`Error revisando schedule de ${user.login}:`, err);
        }
      }

      if (!this.shuttingDown) {
        this.scheduleTimer = setTimeout(run, this.config.schedulePollIntervalMs);
      }
    };

    this.scheduleTimer = setTimeout(run, 5000);
    this.logger.info(`Recordatorios de schedule Twitch activados cada ${this.config.schedulePollIntervalMs} ms.`);
  }

  async checkSchedule(user) {
    const segment = await this.client.getSchedule(user.id);
    if (!segment?.id || !segment?.start_time) {
      return;
    }

    const startMs = new Date(segment.start_time).getTime();
    const now = Date.now();
    const reminderWindowMs = this.config.scheduleReminderMinutes * 60 * 1000;

    if (Number.isNaN(startMs) || startMs < now || startMs - now > reminderWindowMs) {
      return;
    }

    const state = this.stateStore.getTwitch(user.login);
    if (state.lastScheduleSegmentId === segment.id) {
      return;
    }

    const message = await renderTwitchSchedule(this.renderer, user, segment);
    await this.telegram.sendMessage(message);

    state.lastScheduleSegmentId = segment.id;
    state.lastScheduleReminderAt = new Date().toISOString();
    await this.stateStore.save();
    this.logger.info(`Recordatorio de schedule enviado para ${user.login}.`);
  }

  async stop() {
    this.shuttingDown = true;
    this.clearHeartbeat();

    for (const timer of [
      this.reconnectTimer,
      this.refreshTimer,
      this.initialLiveCheckTimer,
      this.scheduleTimer,
    ]) {
      if (timer) {
        clearTimeout(timer);
      }
    }

    this.reconnectTimer = null;
    this.refreshTimer = null;
    this.initialLiveCheckTimer = null;
    this.scheduleTimer = null;

    await new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      const forceCloseTimer = setTimeout(() => {
        try {
          this.ws.terminate();
        } catch {}
        resolve();
      }, 3000);

      this.ws.once('close', () => {
        clearTimeout(forceCloseTimer);
        resolve();
      });

      try {
        this.ws.close();
      } catch {
        clearTimeout(forceCloseTimer);
        resolve();
      }
    });
  }
}
