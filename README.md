# Kala Bot

![Node](https://img.shields.io/badge/node-18+-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Bot que detecta cuando un streamer entra en directo en Twitch y envía automáticamente un aviso formateado a un topic específico de Telegram.
Hecho para el streamer KalathrasLolweapon.

## 📸 Ejemplo

```
━━━━━━━━━━━━━━━━━━
🔴 KalathrasLolweapon EN DIRECTO
━━━━━━━━━━━━━━━━━━

🔗 Link:
https://www.twitch.tv/kalathraslolweapon

📌 Título:
Kala y los Kalalingos vs la India

📅 Fecha:
09-04-2026

📝 Info adicional:
Comprimido

Directos a las 21 horas española

Spacedrum en mangaplus, denle cariño 😼
https://medibang.com/mpc/titles/3v2506130530262220027219089/

🌐 Otras fuentes:


━━━━━━━━━━━━━━━━━━
🏷️ Tags:
#2026 #Abril #
━━━━━━━━━━━━━━━━━━
```

## ✨ Features

- Detección en tiempo real con Twitch EventSub
- Envío automático a Telegram
- Soporte para topics (message_thread_id)
- Formato personalizable del mensaje
- Tags dinámicos por fecha

## ⚙️ Requisitos

- Node.js 18+
- Bot de Telegram
- App de Twitch (Client ID + Token)

## 🚀 Instalación

```bash
git clone git@github.com:gfloresm91/KALA-BOT.git
cd kala-bot
npm install
```

## 🔧 Configuración

Crea un archivo `.env` basado en `.env.example`:

```env
TWITCH_CLIENT_ID=
TWITCH_USER_ACCESS_TOKEN=
TWITCH_STREAMER_LOGIN=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_THREAD_ID=
```

## ▶️ Uso

```bash
npm start
```

## 🧠 Cómo funciona

1. Se conecta a Twitch EventSub (WebSocket)
2. Detecta cuando el streamer inicia directo
3. Obtiene metadata del stream
4. Envía mensaje formateado a Telegram

## 🎨 Personalización

Puedes modificar el formato del mensaje en:

`index.js`

Edita la variable `message` para adaptar el contenido a tu gusto.

## 🔐 Seguridad

⚠️ Nunca subas tu archivo `.env`

Las credenciales deben mantenerse privadas.

## 📄 Licencia

MIT