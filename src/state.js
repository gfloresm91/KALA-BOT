import fs from 'fs/promises';
import { writeFileAtomic } from './utils.js';

function defaultState() {
  return {
    twitch: {},
    youtube: {},
    updatedAt: null,
  };
}

function migrateState(parsed) {
  const state = defaultState();

  if (parsed?.twitch && parsed?.youtube) {
    return {
      twitch: parsed.twitch || {},
      youtube: parsed.youtube || {},
      updatedAt: parsed.updatedAt || null,
    };
  }

  if (parsed?.lastNotifiedStreamId) {
    state.twitch.default = {
      lastNotifiedStreamId: parsed.lastNotifiedStreamId,
    };
  }

  if (parsed?.lastNotifiedYoutubeVideoId) {
    state.youtube.default = {
      lastNotifiedVideoId: parsed.lastNotifiedYoutubeVideoId,
    };
  }

  state.updatedAt = parsed?.updatedAt || null;
  return state;
}

export class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = defaultState();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.state = migrateState(JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }

      this.state = defaultState();
    }

    return this.state;
  }

  async save() {
    this.state.updatedAt = new Date().toISOString();
    await writeFileAtomic(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getTwitch(login) {
    if (!this.state.twitch[login] && this.state.twitch.default) {
      this.state.twitch[login] = { ...this.state.twitch.default };
      delete this.state.twitch.default;
    }

    this.state.twitch[login] ||= {};
    return this.state.twitch[login];
  }

  getYouTube(channelId) {
    if (!this.state.youtube[channelId] && this.state.youtube.default) {
      this.state.youtube[channelId] = { ...this.state.youtube.default };
      delete this.state.youtube.default;
    }

    this.state.youtube[channelId] ||= {};
    return this.state.youtube[channelId];
  }
}
