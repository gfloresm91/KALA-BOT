import { renderYouTubeVideo } from './messages.js';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export class YouTubeMonitor {
  constructor({ config, stateStore, telegram, renderer, logger }) {
    this.config = config;
    this.stateStore = stateStore;
    this.telegram = telegram;
    this.renderer = renderer;
    this.logger = logger;
    this.pollTimer = null;
    this.shuttingDown = false;
  }

  async fetch(apiPath, params = {}) {
    const url = new URL(`${YOUTUBE_API}${apiPath}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    url.searchParams.set('key', this.config.apiKey);

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

  async getUploadsPlaylist(channelId) {
    const data = await this.fetch('/channels', {
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

  parseUploadItem(item) {
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

  async getRecentUploads(uploadsPlaylistId, maxResults = 5) {
    const data = await this.fetch('/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults,
    });

    return (data?.items || [])
      .map((item) => this.parseUploadItem(item))
      .filter(Boolean);
  }

  looksLikeShort(video) {
    const title = String(video?.title || '').toLowerCase();
    const description = String(video?.description || '').toLowerCase();

    return title.includes('#shorts') || description.includes('#shorts');
  }

  withContentType(video) {
    const contentType = this.looksLikeShort(video) ? 'short' : 'video';

    return {
      ...video,
      contentType,
    };
  }

  async checkChannel(channelId, { initial = false } = {}) {
    const state = this.stateStore.getYouTube(channelId);

    if (!state.uploadsPlaylistId) {
      const info = await this.getUploadsPlaylist(channelId);
      state.uploadsPlaylistId = info.uploadsPlaylistId;
      state.channelTitle = info.channelTitle;
      await this.stateStore.save();
      this.logger.info(`YouTube monitoreando canal: ${info.channelTitle} | uploads playlist: ${info.uploadsPlaylistId}`);
    }

    const recentVideos = (await this.getRecentUploads(state.uploadsPlaylistId))
      .map((video) => this.withContentType(video));
    const latestVideo = recentVideos[0] || null;

    if (!latestVideo) {
      this.logger.info(`YouTube ${channelId}: no se encontró video reciente.`);
      return;
    }

    if (!state.lastNotifiedVideoId) {
      state.lastNotifiedVideoId = latestVideo.videoId;
      await this.stateStore.save();
      this.logger.info(`YouTube ${channelId}: estado inicial fijado con video ${latestVideo.videoId}${initial ? ' (sin notificar)' : ''}`);
      return;
    }

    if (state.lastNotifiedVideoId === latestVideo.videoId) {
      this.logger.info(`YouTube ${channelId}: sin novedades. Último video sigue siendo ${latestVideo.videoId}`);
      return;
    }

    const lastNotifiedIndex = recentVideos.findIndex((video) => video.videoId === state.lastNotifiedVideoId);
    const pendingVideos = lastNotifiedIndex === -1
      ? [latestVideo]
      : recentVideos.slice(0, lastNotifiedIndex).reverse();

    for (const video of pendingVideos) {
      if (!this.config.notifyShorts && video.contentType === 'short') {
        this.logger.info(`YouTube ${channelId}: contenido omitido por parecer Short. Video ${video.videoId}`);
        continue;
      }

      const message = await renderYouTubeVideo(this.renderer, video);
      await this.telegram.sendMessage(message);
      this.logger.info(`Aviso de YouTube enviado para ${video.videoId}.`);
    }

    state.lastNotifiedVideoId = latestVideo.videoId;
    await this.stateStore.save();
  }

  async start({ initial = true } = {}) {
    for (const channelId of this.config.channelIds) {
      await this.checkChannel(channelId, { initial });
    }

    const run = async () => {
      if (this.shuttingDown) {
        return;
      }

      try {
        for (const channelId of this.config.channelIds) {
          await this.checkChannel(channelId);
        }
      } catch (err) {
        this.logger.error('Error revisando YouTube:', err);
      } finally {
        if (!this.shuttingDown) {
          this.pollTimer = setTimeout(run, this.config.pollIntervalMs);
        }
      }
    };

    this.pollTimer = setTimeout(run, this.config.pollIntervalMs);
    this.logger.info(`YouTube polling activado cada ${this.config.pollIntervalMs} ms.`);
  }

  stop() {
    this.shuttingDown = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
