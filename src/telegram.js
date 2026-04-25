import { escapeHtml } from './utils.js';

export class TelegramClient {
  constructor({ botToken, chatId, threadId }) {
    this.chatId = chatId;
    this.threadId = threadId;
    this.api = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(text, options = {}) {
    const payload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: options.disableWebPagePreview ?? false,
    };

    if (this.threadId) {
      payload.message_thread_id = Number(this.threadId);
    }

    const res = await fetch(`${this.api}/sendMessage`, {
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

  async sendLifecycle(message) {
    return this.sendMessage(`🤖 <b>Kala Bot</b>\n${escapeHtml(message)}`, {
      disableWebPagePreview: true,
    });
  }

  async sendError(err, context = 'Error') {
    const message = err instanceof Error ? err.message : String(err);
    return this.sendMessage(`⚠️ <b>${escapeHtml(context)}</b>\n${escapeHtml(message)}`, {
      disableWebPagePreview: true,
    });
  }
}
