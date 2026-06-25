import {
  buildEmojiSecret,
  delay,
  EMOJI_KEY_LENGTH,
  getEmojiById,
  log,
  sameSequence,
} from "./helpers.js";
import {
  buildTelegramFileUrl,
  getFile,
  decryptToken,
  describeError,
  encryptToken,
  getMe,
  getUpdates,
  normalizeOutgoingMessage,
  normalizeUpdate,
  sendMessage,
  setupTelegram,
} from "./bot.js";
import {
  clearAllStores,
  ENCRYPTED_TOKEN_KEY,
  getChats,
  getLatestUpdateOffset,
  getMessages,
  getSetting,
  getUpdatesCount,
  POLL_OFFSET_KEY,
  putSetting,
  saveOutgoingMessage,
  saveUpdates,
} from "./memory.js";
import {
  autosizeTextarea,
  buildAuthView,
  getElements,
  hideAuthOverlay,
  renderAuth,
  renderChats,
  renderEmojiGrid,
  renderMessages,
  setComposerState,
  setPollingBadge,
  setStatus,
  setUpdatesCount,
  showAuthOverlay,
} from "./render.js";

const elements = getElements();

const state = {
  activeChatId: "",
  auth: {
    entry: [],
    firstEntry: [],
    mode: "setup",
    secret: "",
    secretReady: false,
  },
  botProfile: null,
  botToken: "",
  composerBusy: false,
  hasStoredToken: false,
  pollOffset: 0,
  pollRunId: 0,
  polling: false,
};

const fileUrlCache = new Map();

function getStoredMedia(message) {
  if (message.media) {
    return message.media;
  }

  if (!message.mediaFileId && !message.thumbFileId) {
    return null;
  }

  return {
    fileId: message.mediaFileId || "",
    height: Number(message.mediaHeight || 0),
    kind: message.mediaType || "",
    thumbFileId: message.thumbFileId || "",
    width: Number(message.mediaWidth || 0),
  };
}

function getAllEmojiIds() {
  return [
    "sun",
    "moon",
    "wave",
    "flame",
    "leaf",
    "apple",
    "balloon",
    "dice",
    "gem",
    "rocket",
    "star",
    "cloud",
  ];
}

function syncVisibleEmojiIds() {
  return getAllEmojiIds();
}

function renderAuthState() {
  renderAuth(
    elements,
    buildAuthView({
      ...state.auth,
      visibleEmojiIds: syncVisibleEmojiIds(),
    })
  );
}

function resetAuthInput() {
  state.auth.entry = [];
  state.auth.firstEntry = [];
  state.auth.secret = "";
  state.auth.secretReady = false;
  renderAuthState();
}

function setAuthMode() {
  state.auth.mode = elements.tokenInput.value.trim()
    ? "setup"
    : state.hasStoredToken
      ? "unlock"
      : "setup";
}

function syncComposer() {
  let placeholder = "Сначала войди в мини-апп...";

  if (state.botToken && !state.activeChatId) {
    placeholder = "Ждем входящие апдейты, чтобы выбрать чат...";
  }

  if (state.botToken && state.activeChatId) {
    placeholder = `Ответ в чат ${state.activeChatId}`;
  }

  setComposerState(elements, {
    busy: state.composerBusy,
    enabled: Boolean(state.botToken && state.activeChatId),
    placeholder,
  });
}

async function resolveFileUrl(fileId) {
  try {
    if (!fileId || !state.botToken) {
      return { data: "", error: null, status: "ok" };
    }

    if (fileUrlCache.has(fileId)) {
      return { data: fileUrlCache.get(fileId), error: null, status: "ok" };
    }

    const fileResult = await getFile(state.botToken, fileId);
    if (fileResult.error || !fileResult.data?.file_path) {
      return { data: "", error: fileResult.error, status: fileResult.status || "error" };
    }

    const fileUrl = buildTelegramFileUrl(state.botToken, fileResult.data.file_path);
    fileUrlCache.set(fileId, fileUrl);

    return {
      data: fileUrl,
      error: null,
      status: "ok",
    };
  } catch (error) {
    return { data: "", error, status: "error" };
  }
}

async function enrichMessagesMedia(messages) {
  try {
    const nextMessages = [];

    for (const message of messages) {
      const nextMessage = { ...message };
      const media = getStoredMedia(nextMessage);
      const mediaView = {
        mediaUrl: "",
        thumbUrl: "",
      };

      if (media?.fileId) {
        const mediaResult = await resolveFileUrl(media.fileId);

        if (!mediaResult.error && mediaResult.data) {
          mediaView.mediaUrl = mediaResult.data;
        }
      }

      if (media?.thumbFileId) {
        const thumbResult = await resolveFileUrl(media.thumbFileId);

        if (!thumbResult.error && thumbResult.data) {
          mediaView.thumbUrl = thumbResult.data;
        }
      }

      nextMessage.mediaView = mediaView;
      nextMessages.push(nextMessage);
    }

    return { data: nextMessages, error: null, status: "ok" };
  } catch (error) {
    return { data: messages, error, status: "error" };
  }
}

async function loadChatsAndMessages() {
  try {
    const chatsResult = await getChats();
    if (chatsResult.error) {
      setStatus(elements, describeError(chatsResult.error));
      return;
    }

    state.activeChatId = renderChats(elements, chatsResult.data, state.activeChatId);

    const messagesResult = await getMessages(state.activeChatId);
    if (messagesResult.error) {
      setStatus(elements, describeError(messagesResult.error));
      return;
    }

    const mediaResult = await enrichMessagesMedia(messagesResult.data);
    renderMessages(elements, mediaResult.data || messagesResult.data);

    const countResult = await getUpdatesCount();
    setUpdatesCount(elements, countResult.data || 0);
    syncComposer();
  } catch (error) {
    setStatus(elements, describeError(error));
  }
}

async function unlockToken() {
  try {
    const encryptedResult = await getSetting(ENCRYPTED_TOKEN_KEY);
    if (encryptedResult.error || !encryptedResult.data) {
      return { data: null, error: new Error("Сохраненный токен не найден."), status: "error" };
    }

    return decryptToken(encryptedResult.data, state.auth.secret);
  } catch (error) {
    return { data: null, error, status: "error" };
  }
}

async function saveToken(token) {
  try {
    const encryptedResult = await encryptToken(token, state.auth.secret);
    if (encryptedResult.error) {
      return encryptedResult;
    }

    const storeResult = await putSetting(ENCRYPTED_TOKEN_KEY, encryptedResult.data);
    if (storeResult.error) {
      return storeResult;
    }

    state.hasStoredToken = true;
    return { data: token, error: null, status: "ok" };
  } catch (error) {
    return { data: null, error, status: "error" };
  }
}

async function connectBot() {
  try {
    let tokenResult = { data: null, error: null, status: "ok" };
    let botResult = { data: null, error: null, status: "ok" };

    if (state.auth.mode === "setup") {
      tokenResult = {
        data: elements.tokenInput.value.trim(),
        error: null,
        status: "ok",
      };
    } else {
      tokenResult = await unlockToken();
    }

    if (tokenResult.error || !tokenResult.data) {
      return tokenResult;
    }

    state.botToken = tokenResult.data;
    fileUrlCache.clear();
    botResult = await getMe(state.botToken);
    if (botResult.error) {
      return botResult;
    }

    state.botProfile = botResult.data;

    if (state.auth.mode === "setup") {
      const storeResult = await saveToken(state.botToken);
      if (storeResult.error) {
        return storeResult;
      }
    }

    const offsetResult = await getSetting(POLL_OFFSET_KEY);
    if (offsetResult.error) {
      return offsetResult;
    }

    if (typeof offsetResult.data === "number") {
      state.pollOffset = offsetResult.data;
    } else {
      const latestOffsetResult = await getLatestUpdateOffset();
      if (latestOffsetResult.error) {
        return latestOffsetResult;
      }
      state.pollOffset = latestOffsetResult.data || 0;
    }

    return { data: botResult.data, error: null, status: "ok" };
  } catch (error) {
    return { data: null, error, status: "error" };
  }
}

async function pollOnce(runId) {
  try {
    const updatesResult = await getUpdates(state.botToken, state.pollOffset);
    if (updatesResult.error) {
      return updatesResult;
    }

    const updates = Array.isArray(updatesResult.data) ? updatesResult.data : [];
    if (!updates.length) {
      return { data: [], error: null, status: "ok" };
    }

    const messages = [];
    let nextOffset = state.pollOffset;

    updates.forEach((update) => {
      const normalized = normalizeUpdate(update);

      if (!normalized.error && normalized.data) {
        messages.push(normalized.data);
      }

      nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
    });

    const saveResult = await saveUpdates(updates, messages, nextOffset);
    if (saveResult.error) {
      return saveResult;
    }

    state.pollOffset = nextOffset;

    if (runId === state.pollRunId) {
      await loadChatsAndMessages();
    }

    return { data: updates, error: null, status: "ok" };
  } catch (error) {
    return { data: null, error, status: "error" };
  }
}

async function startPolling() {
  const runId = state.pollRunId;
  state.polling = true;
  setPollingBadge(elements, "polling");
  log("poll.start", { runId });

  while (state.polling && runId === state.pollRunId && state.botToken) {
    const result = await pollOnce(runId);

    if (result.error) {
      log("poll.error", { message: describeError(result.error) });
      setPollingBadge(elements, "error");
      setStatus(elements, describeError(result.error));
      await delay(2000);
      continue;
    }

    setPollingBadge(elements, "polling");
  }

  if (!state.polling) {
    setPollingBadge(elements, "idle");
  }
}

function stopPolling() {
  state.pollRunId += 1;
  state.polling = false;
  setPollingBadge(elements, "idle");
}

function showLockedScreen() {
  state.botToken = "";
  state.botProfile = null;
  stopPolling();
  setAuthMode();
  resetAuthInput();
  syncComposer();
  showAuthOverlay(elements);
}

async function finishUnlock() {
  const result = await connectBot();

  if (result.error) {
    state.botToken = "";
    state.botProfile = null;
    state.auth.entry = [];
    state.auth.secret = "";
    state.auth.secretReady = false;
    renderAuthState();
    setStatus(elements, describeError(result.error));
    return;
  }

  setStatus(
    elements,
    `Подключено к @${result.data.username || result.data.first_name || result.data.id}`
  );
  hideAuthOverlay(elements);
  await loadChatsAndMessages();
  syncComposer();
  startPolling();
}

function handleEmojiPick(event) {
  const button = event.target.closest("[data-emoji-id]");
  if (!button) {
    return;
  }

  if (state.auth.secretReady) {
    return;
  }

  const emojiId = button.dataset.emojiId;
  if (!getEmojiById(emojiId)) {
    return;
  }

  if (state.auth.entry.includes(emojiId)) {
    state.auth.entry = state.auth.entry.filter((item) => item !== emojiId);
    renderAuthState();
    return;
  }

  if (state.auth.entry.length >= EMOJI_KEY_LENGTH) {
    return;
  }

  state.auth.entry.push(emojiId);
  renderAuthState();

  if (state.auth.mode === "setup" && state.auth.firstEntry.length < EMOJI_KEY_LENGTH) {
    if (state.auth.entry.length === EMOJI_KEY_LENGTH) {
      state.auth.firstEntry = [...state.auth.entry];
      state.auth.entry = [];
      renderAuthState();
    }
    return;
  }

  if (state.auth.entry.length !== EMOJI_KEY_LENGTH) {
    return;
  }

  if (state.auth.mode === "setup") {
    if (sameSequence(state.auth.firstEntry, state.auth.entry)) {
      state.auth.secret = buildEmojiSecret(state.auth.firstEntry);
      state.auth.secretReady = true;
      state.auth.entry = [];
      renderAuthState();
      return;
    }

    state.auth.entry = [];
    state.auth.firstEntry = [];
    state.auth.secret = "";
    state.auth.secretReady = false;
    renderAuthState();
    return;
  }

  state.auth.secret = buildEmojiSecret(state.auth.entry);
  state.auth.secretReady = true;
  state.auth.entry = [];
  renderAuthState();
  finishUnlock();
}

function handleEmojiClear() {
  setAuthMode();
  resetAuthInput();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthMode();

  if (state.auth.mode === "setup" && !elements.tokenInput.value.trim()) {
    return;
  }

  if (!state.auth.secretReady) {
    return;
  }

  const result = await connectBot();

  if (result.error) {
    state.botToken = "";
    state.botProfile = null;
    setStatus(elements, describeError(result.error));
    return;
  }

  setStatus(
    elements,
    `Подключено к @${result.data.username || result.data.first_name || result.data.id}`
  );
  elements.tokenInput.value = "";
  hideAuthOverlay(elements);
  await loadChatsAndMessages();
  syncComposer();
  startPolling();
}

async function handleSendMessage(event) {
  event.preventDefault();

  const text = elements.input.value.trim();
  if (!text || !state.botToken || !state.activeChatId || state.composerBusy) {
    return;
  }

  state.composerBusy = true;
  syncComposer();

  try {
    const sendResult = await sendMessage(state.botToken, state.activeChatId, text);
    if (sendResult.error) {
      setStatus(elements, describeError(sendResult.error));
      return;
    }

    const normalized = normalizeOutgoingMessage(sendResult.data);
    if (normalized.error || !normalized.data) {
      setStatus(elements, "Не удалось подготовить сообщение для рендера.");
      return;
    }

    const saveResult = await saveOutgoingMessage(normalized.data);
    if (saveResult.error) {
      setStatus(elements, describeError(saveResult.error));
      return;
    }

    elements.input.value = "";
    autosizeTextarea(elements);
    await loadChatsAndMessages();
    setStatus(elements, `Сообщение отправлено в чат ${state.activeChatId}.`);
  } finally {
    state.composerBusy = false;
    syncComposer();
  }
}

async function handleChatChange() {
  state.activeChatId = elements.chatPicker.value;
  const result = await getMessages(state.activeChatId);

  if (result.error) {
    setStatus(elements, describeError(result.error));
    return;
  }

  renderMessages(elements, result.data);
  syncComposer();
}

async function handleWipe() {
  stopPolling();

  const result = await clearAllStores();

  if (result.error) {
    setStatus(elements, describeError(result.error));
    return;
  }

  state.activeChatId = "";
  state.botToken = "";
  state.botProfile = null;
  state.hasStoredToken = false;
  state.pollOffset = 0;
  fileUrlCache.clear();
  elements.tokenInput.value = "";
  elements.input.value = "";
  autosizeTextarea(elements);
  state.activeChatId = renderChats(elements, [], "");
  setUpdatesCount(elements, 0);
  setAuthMode();
  resetAuthInput();
  renderMessages(elements, []);
  showAuthOverlay(elements);
  syncComposer();
  setStatus(elements, "Локальное хранилище очищено.");
}

function handleSettingsClick() {
  showLockedScreen();
  setStatus(elements, "Экран входа открыт.");
}

async function init() {
  const telegramResult = setupTelegram();

  if (telegramResult.error) {
    setStatus(elements, describeError(telegramResult.error));
  } else if (telegramResult.data.insideTelegram) {
    setStatus(elements, "mini app открыт внутри Telegram");
  } else {
    setStatus(elements, "страница работает в браузере");
  }

  renderEmojiGrid(elements);
  autosizeTextarea(elements);

  const tokenResult = await getSetting(ENCRYPTED_TOKEN_KEY);
  state.hasStoredToken = Boolean(tokenResult.data);
  setAuthMode();
  resetAuthInput();

  renderMessages(elements, []);
  setPollingBadge(elements, "idle");
  setUpdatesCount(elements, 0);
  syncComposer();
  showAuthOverlay(elements);

  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.chatPicker.addEventListener("change", handleChatChange);
  elements.emojiClearButton.addEventListener("click", handleEmojiClear);
  elements.emojiGrid.addEventListener("click", handleEmojiPick);
  elements.input.addEventListener("input", () => autosizeTextarea(elements));
  elements.settingsButton.addEventListener("click", handleSettingsClick);
  elements.tokenInput.addEventListener("input", () => {
    setAuthMode();
    resetAuthInput();
  });
  elements.wipeButton.addEventListener("click", handleWipe);
  document.getElementById("chat-form").addEventListener("submit", handleSendMessage);
}

init();
