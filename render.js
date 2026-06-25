import { EMOJI_ALPHABET, formatTime } from "./helpers.js";

export function getElements() {
  return {
    authForm: document.getElementById("auth-form"),
    authNote: document.getElementById("auth-note"),
    authOverlay: document.getElementById("auth-overlay"),
    authSubmitButton: document.getElementById("auth-submit-button"),
    authText: document.getElementById("auth-text"),
    authTitle: document.getElementById("auth-title"),
    chatPicker: document.getElementById("chat-picker"),
    emojiClearButton: document.getElementById("emoji-clear-button"),
    emojiGrid: document.getElementById("emoji-grid"),
    emojiPreview: document.getElementById("emoji-preview"),
    input: document.getElementById("message-input"),
    list: document.getElementById("message-list"),
    messageTemplate: document.getElementById("message-template"),
    pollingBadge: document.getElementById("polling-badge"),
    sendButton: document.getElementById("send-button"),
    settingsButton: document.getElementById("settings-button"),
    status: document.getElementById("chat-status"),
    tokenField: document.getElementById("token-field"),
    tokenInput: document.getElementById("token-input"),
    typing: document.getElementById("typing-indicator"),
    updatesBadge: document.getElementById("updates-badge"),
    wipeButton: document.getElementById("wipe-button"),
    wipeRow: document.getElementById("wipe-row"),
  };
}

export function renderEmojiGrid(elements) {
  return renderEmojiButtons(elements, EMOJI_ALPHABET.map((item) => item.id), []);
}

export function renderAuth(elements, auth) {
  elements.tokenField.classList.toggle("hidden", auth.mode !== "setup");
  elements.authSubmitButton.textContent = "Подключить";
  elements.authSubmitButton.classList.toggle("hidden", auth.mode !== "setup");
  elements.emojiClearButton.classList.toggle("hidden", auth.mode !== "setup");
  elements.wipeRow.classList.toggle("hidden", auth.mode === "setup");
  renderEmojiButtons(elements, auth.visibleEmojiIds, auth.selectedIds, auth.secretReady);
  elements.emojiClearButton.disabled = auth.selectedIds.length === 0 && !auth.secretReady;
}

export function showAuthOverlay(elements) {
  elements.authOverlay.classList.remove("hidden");
}

export function hideAuthOverlay(elements) {
  elements.authOverlay.classList.add("hidden");
}

export function setStatus(elements, text) {
  elements.status.textContent = text;
}

export function setPollingBadge(elements, text) {
  elements.pollingBadge.textContent = text;
}

export function setUpdatesCount(elements, count) {
  elements.updatesBadge.textContent = `${count} updates`;
}

export function autosizeTextarea(elements) {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 120)}px`;
}

export function setComposerState(elements, state) {
  elements.sendButton.disabled = state.busy || !state.enabled;
  elements.input.placeholder = state.placeholder;
  elements.typing.classList.toggle("hidden", !state.busy);
}

export function renderChats(elements, chats, activeChatId) {
  elements.chatPicker.innerHTML = "";

  if (!chats.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Ждем апдейты...";
    elements.chatPicker.appendChild(option);
    return "";
  }

  chats.forEach((chat) => {
    const option = document.createElement("option");
    option.value = chat.chatId;
    option.textContent = chat.chatTitle || chat.chatId;
    elements.chatPicker.appendChild(option);
  });

  const hasActiveChat = chats.some((chat) => chat.chatId === activeChatId);
  const nextActiveChatId = hasActiveChat ? activeChatId : chats[0].chatId;
  elements.chatPicker.value = nextActiveChatId;
  return nextActiveChatId;
}

export function renderMessages(elements, messages) {
  elements.list.innerHTML = "";

  if (!messages.length) {
    const node = elements.messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add("system");
    node.querySelector(".message-author").textContent = "Система";
    node.querySelector(".message-text").textContent =
      "Сообщений пока нет. Дождись апдейтов от Telegram.";
    node.querySelector(".message-chat").textContent = "";
    node.querySelector(".message-time").textContent = formatTime();
    elements.list.appendChild(node);
    return;
  }

  messages.forEach((message) => {
    const node = elements.messageTemplate.content.firstElementChild.cloneNode(true);
    const bubble = node.querySelector(".bubble");
    const textNode = node.querySelector(".message-text");
    const media =
      message.media ||
      (message.mediaFileId || message.thumbFileId
        ? {
            fileId: message.mediaFileId || "",
            height: Number(message.mediaHeight || 0),
            kind: message.mediaType || "",
            thumbFileId: message.thumbFileId || "",
            width: Number(message.mediaWidth || 0),
          }
        : null);
    const mediaView = message.mediaView || {};

    node.classList.add(message.role || "system");
    node.querySelector(".message-author").textContent = message.senderName || "Telegram";

    if (
      media &&
      ["photo", "video", "document"].includes(media.kind) &&
      (mediaView.mediaUrl || mediaView.thumbUrl)
    ) {
      const mediaNode = document.createElement("img");
      const mediaSource =
        media.kind === "photo"
          ? mediaView.mediaUrl || mediaView.thumbUrl
          : mediaView.thumbUrl || mediaView.mediaUrl;

      mediaNode.className = "message-media";
      mediaNode.src = mediaSource;
      mediaNode.alt = message.text || media.kind || "media";
      mediaNode.loading = "lazy";

      if (media.width && media.height) {
        mediaNode.width = media.width;
        mediaNode.height = media.height;
      }

      bubble.insertBefore(mediaNode, textNode);
    }

    if (media && ["audio", "voice"].includes(media.kind) && mediaView.mediaUrl) {
      const audio = document.createElement("audio");

      audio.className = "message-audio";
      audio.controls = true;
      audio.preload = "none";
      audio.src = mediaView.mediaUrl;
      bubble.insertBefore(audio, textNode);
    }

    textNode.textContent =
      message.text && (message.text !== "[photo]" || media?.kind !== "photo")
        ? message.text
        : mediaView.mediaUrl || mediaView.thumbUrl
          ? ""
          : "[empty]";

    node.querySelector(".message-chat").textContent = message.chatTitle || "";
    node.querySelector(".message-time").textContent = message.time || formatTime();
    elements.list.appendChild(node);
  });

  elements.list.scrollTop = elements.list.scrollHeight;
}

export function buildAuthView(state) {
  return {
    mode: state.mode,
    secretReady: state.secretReady,
    selectedIds:
      state.mode === "setup" && state.secretReady
        ? [...state.firstEntry]
        : [...state.entry],
    visibleEmojiIds: state.visibleEmojiIds,
  };
}

function renderEmojiButtons(elements, ids, selectedIds = [], lockAll = false) {
  elements.emojiGrid.innerHTML = "";
  elements.emojiGrid.classList.add("emoji-keyboard");

  ids.forEach((id) => {
    const item = EMOJI_ALPHABET.find((emoji) => emoji.id === id);
    if (!item) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-key-button";
    button.dataset.emojiId = item.id;
    button.textContent = item.emoji;

    if (selectedIds.includes(item.id)) {
      button.classList.add("selected");
    }

    if (lockAll) {
      button.disabled = true;
    }

    elements.emojiGrid.appendChild(button);
  });

  return elements.emojiGrid;
}
