# Kala Bot

![Node](https://img.shields.io/badge/node-18+-green)
![License](https://img.shields.io/badge/license-MIT-blue)

Bot que detecta actividad de Twitch y YouTube, y envía automáticamente avisos formateados a un topic específico de Telegram.
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
- Aviso cuando un directo de Twitch termina
- Refresh automático del access token de Twitch
- Monitoreo de uno o varios streamers
- Polling opcional de nuevos videos de YouTube
- Monitoreo de uno o varios canales de YouTube
- Recordatorios opcionales de directos programados en Twitch
- Notificaciones opcionales de inicio/apagado/error del servicio
- Healthcheck por archivo para procesos en segundo plano
- Envío automático a Telegram
- Soporte para topics (message_thread_id)
- Formato personalizable con archivos en `templates/`
- Tags dinámicos por fecha

## ⚙️ Requisitos

- Node.js 18+
- Bot de Telegram
- App de Twitch (Client ID, Client Secret, Access Token y Refresh Token)
- API key de YouTube si quieres activar el monitoreo de videos

## 🚀 Instalación

```bash
git clone git@github.com:gfloresm91/KALA-BOT.git
cd kala-bot
npm install
```

## 🔧 Configuración

Crea un archivo `.env` basado en `.env_example`:

```env
# Twitch
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_USER_ACCESS_TOKEN=
TWITCH_REFRESH_TOKEN=
TWITCH_STREAMER_LOGIN=kalathraslolweapon
TWITCH_STREAMER_LOGINS=
TWITCH_NOTIFY_ON_STARTUP=true
TWITCH_EXTRA_INFO=Comprimido\n\nDirectos a las 21 horas española
TWITCH_OTHER_SOURCES=
TWITCH_SCHEDULE_REMINDERS=false
TWITCH_SCHEDULE_POLL_INTERVAL_MS=900000
TWITCH_SCHEDULE_REMINDER_MINUTES=60

# Youtube opcional
YOUTUBE_API_KEY=
YOUTUBE_CHANNEL_ID=
YOUTUBE_CHANNEL_IDS=
YOUTUBE_POLL_INTERVAL_MS=300000
YOUTUBE_NOTIFY_SHORTS=true

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_THREAD_ID=
TELEGRAM_NOTIFY_LIFECYCLE=false
TELEGRAM_NOTIFY_ERRORS=true

# Healthcheck / logs
HEALTH_WRITE_INTERVAL_MS=30000
HEALTH_MAX_AGE_MS=120000
LOG_LEVEL=info

# Opcional
CHECK_DUPLICATES=true
```

Para múltiples streamers o canales, usa las variables en plural separadas por coma. Las variables singulares se mantienen por compatibilidad.

### Variables principales

| Variable | Descripción |
| --- | --- |
| `TWITCH_CLIENT_ID` | Client ID de la app de Twitch. |
| `TWITCH_CLIENT_SECRET` | Client Secret de la app de Twitch. |
| `TWITCH_USER_ACCESS_TOKEN` | Access token de Twitch. El bot lo puede refrescar automáticamente. |
| `TWITCH_REFRESH_TOKEN` | Refresh token de Twitch. El bot lo puede refrescar automáticamente. |
| `TWITCH_STREAMER_LOGIN` | Login de Twitch a monitorear cuando usas un solo streamer. |
| `TWITCH_STREAMER_LOGINS` | Lista separada por comas para monitorear varios streamers. Tiene prioridad sobre `TWITCH_STREAMER_LOGIN`. |
| `TWITCH_NOTIFY_ON_STARTUP` | Si es `true`, avisa si el streamer ya estaba en directo al iniciar el bot. |
| `TWITCH_EXTRA_INFO` | Texto extra para el aviso de directo. Usa `\n` para saltos de línea. |
| `TWITCH_OTHER_SOURCES` | Texto opcional para la sección de otras fuentes. Usa `\n` para saltos de línea. |
| `TWITCH_SCHEDULE_REMINDERS` | Activa recordatorios de directos programados. |
| `TWITCH_SCHEDULE_POLL_INTERVAL_MS` | Intervalo para revisar schedules de Twitch. |
| `TWITCH_SCHEDULE_REMINDER_MINUTES` | Minutos antes del directo programado en los que se permite enviar recordatorio. |
| `YOUTUBE_API_KEY` | API key de YouTube. |
| `YOUTUBE_CHANNEL_ID` | Canal de YouTube a monitorear cuando usas un solo canal. |
| `YOUTUBE_CHANNEL_IDS` | Lista separada por comas para monitorear varios canales. Tiene prioridad sobre `YOUTUBE_CHANNEL_ID`. |
| `YOUTUBE_POLL_INTERVAL_MS` | Intervalo para revisar nuevos uploads. |
| `YOUTUBE_NOTIFY_SHORTS` | Si es `false`, omite Shorts detectados. |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram. |
| `TELEGRAM_CHAT_ID` | Chat o grupo destino. |
| `TELEGRAM_THREAD_ID` | Topic/hilo destino dentro del grupo. |
| `TELEGRAM_NOTIFY_LIFECYCLE` | Envía avisos al iniciar o apagar el bot. |
| `TELEGRAM_NOTIFY_ERRORS` | Envía avisos de errores críticos. |
| `HEALTH_WRITE_INTERVAL_MS` | Frecuencia con la que se actualiza `bot-health.json`. |
| `HEALTH_MAX_AGE_MS` | Edad máxima aceptada por `npm run health`. |
| `LOG_LEVEL` | Nivel de logs: `debug`, `info`, `warn` o `error`. |
| `CHECK_DUPLICATES` | Evita repetir avisos del mismo stream. |

Ejemplo de texto multilinea:

```env
TWITCH_EXTRA_INFO=Comprimido\n\nDirectos a las 21 horas española\n\nSpacedrum en mangaplus, denle cariño 😼\nhttps://medibang.com/mpc/titles/3v2506130530262220027219089/
```

El bot convierte esos `\n` en saltos de línea reales antes de enviar el mensaje.

### Permisos de Twitch

El token de Twitch debe pertenecer al mismo `TWITCH_CLIENT_ID` configurado. Para las notificaciones de directo se crean suscripciones EventSub de `stream.online` y `stream.offline`. Si activas `TWITCH_SCHEDULE_REMINDERS=true`, el token también debe poder leer el schedule del broadcaster configurado.

Cuando Twitch refresca el token, el bot actualiza `TWITCH_USER_ACCESS_TOKEN` y `TWITCH_REFRESH_TOKEN` dentro de `.env`, por lo que el proceso debe tener permisos de escritura sobre ese archivo.

### Notas de YouTube

Los Shorts se detectan por heurística buscando `#shorts` en el título o la descripción del upload. YouTube no entrega en este endpoint un campo perfecto que distinga siempre entre video normal y Short.

## ▶️ Uso

```bash
npm start
```

Para validar sintaxis sin iniciar el bot:

```bash
npm run check
```

Para validar que un proceso vivo está escribiendo healthcheck:

```bash
npm run health
```

Este comando lee `bot-health.json` y falla si el archivo no existe, no es válido o su `updatedAt` supera `HEALTH_MAX_AGE_MS`.

## 🧠 Cómo funciona

1. Se conecta a Twitch EventSub (WebSocket)
2. Detecta cuando un streamer inicia o termina directo
3. Obtiene metadata del stream
4. Revisa YouTube periódicamente si está configurado
5. Revisa schedules de Twitch si `TWITCH_SCHEDULE_REMINDERS=true`
6. Envía mensajes formateados a Telegram

### Comportamiento inicial y duplicados

- En YouTube, el primer chequeo fija el último video encontrado como baseline y no lo notifica. A partir de ahí, solo avisa uploads nuevos.
- El aviso de Twitch offline requiere que el bot haya registrado previamente el inicio del directo en `bot-state.json`; si no conoce la hora de inicio, omite el aviso de fin.
- Los recordatorios de schedule revisan el próximo segmento disponible y envían como máximo un recordatorio por segmento dentro de la ventana definida por `TWITCH_SCHEDULE_REMINDER_MINUTES`.
- Si `CHECK_DUPLICATES=true`, el bot evita repetir avisos del mismo stream de Twitch.

## 🎨 Personalización

Puedes personalizar mensajes creando estos archivos opcionales:

- `templates/twitch-live.txt`
- `templates/twitch-offline.txt`
- `templates/twitch-schedule.txt`
- `templates/youtube-video.txt`
- `templates/youtube-short.txt`

Si un archivo no existe, el bot usa la plantilla interna por defecto. Para YouTube, los videos normales usan `youtube-video.txt` y los Shorts usan `youtube-short.txt`. Las variables disponibles son placeholders como `{{DISPLAY_NAME}}`, `{{URL}}`, `{{TITLE}}`, `{{DATE}}`, `{{EXTRA_INFO}}`, `{{OTHER_SOURCES}}`, `{{TAGS}}`, `{{DURATION}}`, `{{START_TIME}}`, `{{CHANNEL_TITLE}}`, `{{CONTENT_TYPE}}` y `{{CONTENT_TYPE_LABEL}}`, según el tipo de mensaje.

### Placeholders por template

| Template | Placeholders |
| --- | --- |
| `twitch-live.txt` | `DISPLAY_NAME`, `URL`, `TITLE`, `DATE`, `EXTRA_INFO`, `OTHER_SOURCES`, `TAGS` |
| `twitch-offline.txt` | `DISPLAY_NAME`, `URL`, `DURATION` |
| `twitch-schedule.txt` | `DISPLAY_NAME`, `URL`, `TITLE`, `START_TIME` |
| `youtube-video.txt` | `CHANNEL_TITLE`, `CONTENT_TYPE`, `CONTENT_TYPE_LABEL`, `URL`, `TITLE`, `DATE` |
| `youtube-short.txt` | `CHANNEL_TITLE`, `CONTENT_TYPE`, `CONTENT_TYPE_LABEL`, `URL`, `TITLE`, `DATE` |

## 🔐 Seguridad

⚠️ Nunca subas tu archivo `.env`

Las credenciales deben mantenerse privadas.

El archivo `bot-state.json` guarda los últimos streams/videos/schedules notificados y también debe tratarse como dato runtime. Si ejecutas el bot en un servidor, ponlo en una ruta persistente para evitar duplicados después de reinicios.

## 🛠️ Operación

El bot maneja `SIGINT` y `SIGTERM`, por lo que puede cerrar timers/WebSocket de forma ordenada cuando el proceso se detiene.

Además de `bot-state.json`, el bot escribe `bot-health.json` cada `HEALTH_WRITE_INTERVAL_MS`. Durante escrituras atómicas pueden aparecer temporales `bot-state.json.*.tmp` o `bot-health.json.*.tmp`; están pensados como archivos runtime y no deberían versionarse.

## 📄 Licencia

MIT
