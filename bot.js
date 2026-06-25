import {
  base64ToBytes,
  bytesToBase64,
  fail,
  formatUnixTime,
  ok,
} from "./helpers.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function setupTelegram() {
  try {
    const tg = window.Telegram?.WebApp;

    if (!tg) {
      return ok({ insideTelegram: false });
    }

    tg.ready();

    if (tg.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }

    const theme = tg.themeParams || {};
    const root = document.documentElement;

    if (theme.text_color) {
      root.style.setProperty("--text", theme.text_color);
    }

    if (theme.hint_color) {
      root.style.setProperty("--muted", theme.hint_color);
    }

    if (theme.button_color) {
      root.style.setProperty("--brand", theme.button_color);
    }

    return ok({
      insideTelegram: true,
      viewportHeight: tg.viewportHeight || null,
    });
  } catch (error) {
    return fail(error);
  }
}

export function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/Failed to fetch|NetworkError/i.test(message)) {
    return "Браузер не достучался до Bot API. Если это CORS, понадобится proxy.";
  }

  if (/terminated by other getUpdates request/i.test(message)) {
    return "Есть второй polling-процесс для этого токена.";
  }

  if (/can't use getUpdates method while webhook is active/i.test(message)) {
    return "Для токена активен webhook. С polling это несовместимо.";
  }

  if (/operation-specific reason/i.test(message)) {
    return "Неверный emoji-ключ или поврежденные локальные данные.";
  }

  return message;
}

async function callBotApi(token, method, params = {}) {
  try {
    const response = await window.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    const payload = await response.json();

    if (!payload.ok) {
      return fail(new Error(payload.description || `Bot API error in ${method}`));
    }

    return ok(payload.result);
  } catch (error) {
    return fail(error);
  }
}

export async function getMe(token) {
  return callBotApi(token, "getMe");
}

export async function getFile(token, fileId) {
  return callBotApi(token, "getFile", {
    file_id: fileId,
  });
}

export function buildTelegramFileUrl(token, filePath) {
  if (!token || !filePath) {
    return "";
  }

  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export async function getUpdates(token, offset) {
  return callBotApi(token, "getUpdates", {
    allowed_updates: [
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
      "business_message",
      "edited_business_message",
      "callback_query",
    ],
    offset,
    timeout: 25,
  });
}

export async function sendMessage(token, chatId, text) {
  return callBotApi(token, "sendMessage", {
    chat_id: Number(chatId),
    text,
  });
}

function resolvePersonName(person) {
  if (!person) {
    return "Unknown";
  }

  const fullName = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  return fullName || person.username || String(person.id || "Unknown");
}

function resolveChatTitle(chat, from) {
  if (!chat) {
    return resolvePersonName(from);
  }

  if (chat.title) {
    return chat.title;
  }

  const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  return fullName || chat.username || resolvePersonName(from);
}

function summarizeMessage(message) {
  if (message.text) {
    return message.text;
  }

  if (message.caption) {
    return message.caption;
  }

  if (message.location) {
    return message.location;
  }

  if (message.sticker) {
    return `[sticker] ${message.sticker.emoji || ""}`.trim();
  }

  if (message.photo) {
    return "[photo]";
  }

  if (message.audio) {
    return `[audio] ${message.audio.title || message.audio.file_name || ""}`.trim();
  }

  if (message.voice) {
    return "[voice]";
  }

  if (message.video) {
    return "[video]";
  }

  if (message.document) {
    if ((message.document.mime_type || "").indexOf("video/") === 0) {
      return "[video]";
    }

    if ((message.document.mime_type || "").indexOf("audio/") === 0) {
      return `[audio] ${message.document.file_name || ""}`.trim();
    }

    return `[file] ${message.document.file_name || ""}`.trim();
  }

  return "[unsupported message]";
}

function getPhotoMedia(message) {
  if (!Array.isArray(message.photo) || !message.photo.length) {
    return null;
  }

  const sorted = [...message.photo].sort((left, right) => {
    const leftArea = Number(left.width || 0) * Number(left.height || 0);
    const rightArea = Number(right.width || 0) * Number(right.height || 0);
    return leftArea - rightArea;
  });

  return {
    fileId: sorted[sorted.length - 1]?.file_id || "",
    height: Number(sorted[sorted.length - 1]?.height || 0),
    kind: "photo",
    thumbFileId: sorted[0]?.file_id || "",
    width: Number(sorted[sorted.length - 1]?.width || 0),
  };
}

function getVideoMedia(message) {
  if (!message.video) {
    return null;
  }

  return {
    duration: Number(message.video.duration || 0),
    fileId: message.video.file_id || "",
    height: Number(message.video.height || 0),
    kind: "video",
    thumbFileId: message.video.thumbnail?.file_id || "",
    width: Number(message.video.width || 0),
  };
}

function getDocumentMedia(message) {
  if (!message.document) {
    return null;
  }

  const mimeType = message.document.mime_type || "";
  const fileName = (message.document.file_name || "").toLowerCase();
  let kind = "document";

  if (
    mimeType.indexOf("video/") === 0 ||
    /\.(mp4|webm|mov|m4v)$/i.test(fileName)
  ) {
    kind = "video";
  } else if (
    mimeType.indexOf("audio/") === 0 ||
    /\.(mp3|m4a|ogg|wav|aac|flac)$/i.test(fileName)
  ) {
    kind = "audio";
  }

  return {
    duration: 0,
    fileId: message.document.file_id || "",
    fileName: message.document.file_name || "",
    height: Number(message.document.thumbnail?.height || 0),
    kind,
    mimeType,
    size: Number(message.document.file_size || 0),
    thumbFileId: message.document.thumbnail?.file_id || "",
    width: Number(message.document.thumbnail?.width || 0),
  };
}

function getAudioMedia(message) {
  if (!message.audio) {
    return null;
  }

  return {
    duration: Number(message.audio.duration || 0),
    fileId: message.audio.file_id || "",
    fileName: message.audio.file_name || "",
    kind: "audio",
    mimeType: message.audio.mime_type || "",
    performer: message.audio.performer || "",
    size: Number(message.audio.file_size || 0),
    title: message.audio.title || "",
  };
}

function getVoiceMedia(message) {
  if (!message.voice) {
    return null;
  }

  return {
    duration: Number(message.voice.duration || 0),
    fileId: message.voice.file_id || "",
    kind: "voice",
    mimeType: message.voice.mime_type || "",
    size: Number(message.voice.file_size || 0),
  };
}

function getMessageMedia(message) {
  return (
    getPhotoMedia(message) ||
    getVideoMedia(message) ||
    getAudioMedia(message) ||
    getVoiceMedia(message) ||
    getDocumentMedia(message)
  );
}

function normalizeMessage(message, meta) {
  const createdAtSeconds = message.edit_date || message.date || Math.floor(Date.now() / 1000);
  const media = getMessageMedia(message);

  return {
    chatId: String(message.chat?.id ?? message.from?.id ?? "unknown"),
    chatTitle: resolveChatTitle(message.chat, message.from),
    chatType: message.chat?.type || "private",
    createdAt: createdAtSeconds * 1000,
    id: meta.id,
    messageId: message.message_id || null,
    role: message.from?.is_bot ? "bot" : "user",
    senderId: message.from?.id ? String(message.from.id) : "",
    senderName: resolvePersonName(message.from),
    source: meta.source,
    text: summarizeMessage(message),
    time: formatUnixTime(createdAtSeconds),
    media: media || null,
    updateId: meta.updateId ?? null,
    updateType: meta.updateType,
  };
}

export function normalizeUpdate(update) {
  try {
    const types = [
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
      "business_message",
      "edited_business_message",
    ];

    for (const type of types) {
      if (update[type]) {
        return ok(
          normalizeMessage(update[type], {
            id: `update:${update.update_id}:${type}`,
            source: "update",
            updateId: update.update_id,
            updateType: type,
          })
        );
      }
    }

    if (update.callback_query) {
      const callback = update.callback_query;
      const createdAtSeconds = callback.message?.date || Math.floor(Date.now() / 1000);

      return ok({
        chatId: String(callback.message?.chat?.id ?? callback.from?.id ?? "callback"),
        chatTitle: resolveChatTitle(callback.message?.chat, callback.from),
        chatType: callback.message?.chat?.type || "private",
        createdAt: createdAtSeconds * 1000,
        id: `update:${update.update_id}:callback_query`,
        messageId: callback.message?.message_id || null,
        role: "user",
        senderId: callback.from?.id ? String(callback.from.id) : "",
        senderName: resolvePersonName(callback.from),
        source: "update",
        text: `[callback] ${callback.data || callback.id}`,
        time: formatUnixTime(createdAtSeconds),
        updateId: update.update_id,
        updateType: "callback_query",
      });
    }

    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

async function deriveKey(secret, salt) {
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 250000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptToken(token, secret) {
  try {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      textEncoder.encode(token)
    );

    return ok({
      cipher: bytesToBase64(new Uint8Array(cipherBuffer)),
      iv: bytesToBase64(iv),
      salt: bytesToBase64(salt),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function decryptToken(payload, secret) {
  try {
    const key = await deriveKey(secret, base64ToBytes(payload.salt));
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.cipher)
    );

    return ok(textDecoder.decode(plainBuffer));
  } catch (error) {
    return fail(error);
  }
}

export function normalizeOutgoingMessage(message) {
  try {
    return ok(
      normalizeMessage(message, {
        id: `outgoing:${message.chat.id}:${message.message_id}`,
        source: "outgoing",
        updateType: "sendMessage",
      })
    );
  } catch (error) {
    return fail(error);
  }
}
