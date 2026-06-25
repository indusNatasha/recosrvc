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
  getAllMessages,
  getChats,
  getLatestUpdateOffset,
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
  activeTab: "chat",
  allMessages: [],
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
  mapDrawerGroupKey: "",
  mapInstance: null,
  mapMarkers: [],
  pollOffset: 0,
  pollRunId: 0,
  polling: false,
};

const fileUrlCache = new Map();
const LIBRARY_SECTIONS = [
  { id: "photo", title: "Фото" },
  { id: "video", title: "Видео" },
  { id: "audio", title: "Аудио" },
  { id: "text", title: "Текст" },
];

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

function getMessageLocation(message) {
  if (!message || !message.location) {
    return null;
  }

  if (
    !Number.isFinite(Number(message.location.latitude)) ||
    !Number.isFinite(Number(message.location.longitude))
  ) {
    return null;
  }

  return {
    latitude: Number(message.location.latitude),
    longitude: Number(message.location.longitude),
  };
}

function getLibrarySectionId(message) {
  const media = getStoredMedia(message);

  if (media?.kind === "photo") {
    return "photo";
  }

  if (media?.kind === "video") {
    return "video";
  }

  if (media?.kind === "audio" || media?.kind === "voice") {
    return "audio";
  }

  if (!media && !getMessageLocation(message) && message.text) {
    return "text";
  }

  return "";
}

function formatLocationLabel(location) {
  if (!location) {
    return "";
  }

  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

function buildLocationGroups(messages) {
  const groupsMap = new Map();

  messages.forEach((message) => {
    const location = getMessageLocation(message);
    let group;
    let key;

    if (!location) {
      return;
    }

    key = `${location.latitude.toFixed(5)}:${location.longitude.toFixed(5)}`;
    group = groupsMap.get(key);

    if (!group) {
      group = {
        key,
        latitude: location.latitude,
        longitude: location.longitude,
        items: [],
      };
      groupsMap.set(key, group);
    }

    group.items.push(message);
  });

  return Array.from(groupsMap.values())
    .map((group) => {
      group.items.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      return group;
    })
    .sort((left, right) => (right.items[0]?.createdAt || 0) - (left.items[0]?.createdAt || 0));
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

function syncTabs() {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });

  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === state.activeTab);
  });
}

function buildMediaNode(message) {
  const media = getStoredMedia(message);
  const mediaView = message.mediaView || {};
  let node;

  if (!media) {
    return null;
  }

  if (media.kind === "photo" && (mediaView.mediaUrl || mediaView.thumbUrl)) {
    node = document.createElement("img");
    node.className = "library-media";
    node.src = mediaView.mediaUrl || mediaView.thumbUrl;
    node.alt = message.text || "photo";
    node.loading = "lazy";
    return node;
  }

  if (media.kind === "video" && mediaView.mediaUrl) {
    node = document.createElement("video");
    node.className = "library-media";
    node.controls = true;
    node.playsInline = true;
    node.preload = "metadata";
    node.src = mediaView.mediaUrl;

    if (mediaView.thumbUrl) {
      node.poster = mediaView.thumbUrl;
    }

    return node;
  }

  if ((media.kind === "audio" || media.kind === "voice") && mediaView.mediaUrl) {
    node = document.createElement("audio");
    node.className = "library-audio";
    node.controls = true;
    node.preload = "metadata";
    node.src = mediaView.mediaUrl;
    return node;
  }

  return null;
}

function renderLibrary() {
  const groups = LIBRARY_SECTIONS.map((section) => {
    return {
      ...section,
      items: state.allMessages.filter((message) => getLibrarySectionId(message) === section.id),
    };
  }).filter((section) => section.items.length);

  const mediaCount = groups
    .filter((section) => section.id !== "text")
    .reduce((sum, section) => sum + section.items.length, 0);
  const textCount = groups
    .filter((section) => section.id === "text")
    .reduce((sum, section) => sum + section.items.length, 0);

  elements.libraryBadge.textContent = `${mediaCount} медиа`;
  elements.libraryTextBadge.textContent = `${textCount} текстов`;
  elements.libraryGroups.innerHTML = "";

  if (!groups.length) {
    elements.libraryGroups.innerHTML =
      '<div class="panel-empty">Файлов и текстов пока нет. Сначала получи сообщения от Telegram.</div>';
    return;
  }

  groups.forEach((section, index) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const itemsWrap = document.createElement("div");

    details.className = "library-group";
    details.open = index === 0;
    summary.className = "library-summary";
    summary.innerHTML = `<span>${section.title}</span><span class="badge">${section.items.length}</span>`;
    itemsWrap.className = "library-items";

    section.items.forEach((message) => {
      const item = document.createElement("article");
      const meta = document.createElement("div");
      const title = document.createElement("p");
      let text;
      const mediaNode = buildMediaNode(message);
      const location = getMessageLocation(message);

      item.className = "library-item";
      meta.className = "library-item-meta";
      meta.textContent = `${message.chatTitle || "Chat"} • ${message.senderName || "Telegram"} • ${message.time || ""}`;
      title.className = "library-item-title";
      item.appendChild(meta);

      if (section.id !== "text") {
        title.textContent = message.text || "Без подписи";
        item.appendChild(title);
      }

      if (location) {
        text = document.createElement("p");
        text.className = "library-item-text";
        text.textContent = `Локация: ${formatLocationLabel(location)}`;
        item.appendChild(text);
      }

      if (mediaNode) {
        item.appendChild(mediaNode);
      }

      if (section.id === "text" && message.text) {
        text = document.createElement("p");
        text.className = "library-item-text";
        text.textContent = message.text;
        item.appendChild(text);
      }

      itemsWrap.appendChild(item);
    });

    details.appendChild(summary);
    details.appendChild(itemsWrap);
    elements.libraryGroups.appendChild(details);
  });
}

function renderMapDrawer(group) {
  elements.mapDrawerList.innerHTML = "";

  if (!group) {
    elements.mapDrawer.classList.add("hidden");
    elements.mapDrawer.setAttribute("aria-hidden", "true");
    return;
  }

  elements.mapDrawerTitle.textContent = `Точка • ${formatLocationLabel(group)}`;

  group.items.forEach((message) => {
    const item = document.createElement("article");
    const meta = document.createElement("p");
    const text = document.createElement("p");

    item.className = "map-drawer-item";
    meta.className = "map-drawer-meta";
    meta.textContent = `${message.chatTitle || "Chat"} • ${message.senderName || "Telegram"} • ${message.time || ""}`;
    text.className = "map-drawer-text";
    text.textContent = message.text || `Локация ${formatLocationLabel(getMessageLocation(message))}`;

    item.appendChild(meta);
    item.appendChild(text);
    elements.mapDrawerList.appendChild(item);
  });

  elements.mapDrawer.classList.remove("hidden");
  elements.mapDrawer.setAttribute("aria-hidden", "false");
}

function closeMapDrawer() {
  state.mapDrawerGroupKey = "";
  renderMapDrawer(null);
}

function ensureMap() {
  if (state.mapInstance || !window.maplibregl || !elements.mapCanvas) {
    return;
  }

  state.mapInstance = new window.maplibregl.Map({
    container: "map-canvas",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [104.9282, 11.5564],
    zoom: 11,
    attributionControl: false,
  });

  state.mapInstance.addControl(new window.maplibregl.NavigationControl(), "top-right");
}

function renderMapMarkers() {
  const groups = buildLocationGroups(state.allMessages);
  let bounds;

  elements.mapPointsBadge.textContent = `${groups.length} точек`;
  elements.mapMessagesBadge.textContent = `${groups.reduce((sum, group) => sum + group.items.length, 0)} локаций`;
  elements.mapEmpty.classList.toggle("hidden", groups.length > 0);

  if (!state.mapInstance && state.activeTab !== "map") {
    if (state.mapDrawerGroupKey) {
      renderMapDrawer(groups.find((group) => group.key === state.mapDrawerGroupKey) || null);
    }
    return;
  }

  ensureMap();

  if (!state.mapInstance) {
    return;
  }

  state.mapMarkers.forEach((marker) => marker.remove());
  state.mapMarkers = [];
  bounds = new window.maplibregl.LngLatBounds();

  groups.forEach((group) => {
    const el = document.createElement("button");
    const count = document.createElement("span");

    el.type = "button";
    el.className = "map-marker";
    count.className = "map-marker-count";
    count.textContent = String(group.items.length);
    el.appendChild(count);
    el.addEventListener("click", () => {
      state.mapDrawerGroupKey = group.key;
      renderMapDrawer(group);
      state.mapInstance.flyTo({
        center: [group.longitude, group.latitude],
        zoom: Math.max(state.mapInstance.getZoom(), 13),
        essential: true,
      });
    });

    state.mapMarkers.push(
      new window.maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([group.longitude, group.latitude])
        .addTo(state.mapInstance)
    );

    bounds.extend([group.longitude, group.latitude]);
  });

  if (state.activeTab === "map" && groups.length === 1) {
    state.mapInstance.flyTo({
      center: [groups[0].longitude, groups[0].latitude],
      zoom: 13,
      essential: true,
    });
  } else if (state.activeTab === "map" && groups.length > 1) {
    state.mapInstance.fitBounds(bounds, {
      padding: 48,
      maxZoom: 13,
      duration: 0,
    });
  }

  if (state.mapDrawerGroupKey) {
    renderMapDrawer(groups.find((group) => group.key === state.mapDrawerGroupKey) || null);
  }
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
    const allMessagesResult = await getAllMessages();
    const chatsResult = await getChats();

    if (allMessagesResult.error) {
      setStatus(elements, describeError(allMessagesResult.error));
      return;
    }

    if (chatsResult.error) {
      setStatus(elements, describeError(chatsResult.error));
      return;
    }

    state.allMessages = allMessagesResult.data || [];
    state.activeChatId = renderChats(elements, chatsResult.data, state.activeChatId);
    const mediaResult = await enrichMessagesMedia(state.allMessages);
    const viewMessages = mediaResult.data || state.allMessages;
    const activeMessages = viewMessages
      .filter((message) => message.chatId === state.activeChatId)
      .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));

    state.allMessages = viewMessages;
    renderMessages(elements, activeMessages);
    renderLibrary();
    renderMapMarkers();

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
  renderMessages(
    elements,
    state.allMessages
      .filter((message) => message.chatId === state.activeChatId)
      .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
  );
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
  state.activeTab = "chat";
  state.allMessages = [];
  state.botToken = "";
  state.botProfile = null;
  state.hasStoredToken = false;
  state.mapDrawerGroupKey = "";
  state.pollOffset = 0;
  fileUrlCache.clear();
  closeMapDrawer();
  if (state.mapMarkers.length) {
    state.mapMarkers.forEach((marker) => marker.remove());
    state.mapMarkers = [];
  }
  elements.tokenInput.value = "";
  elements.input.value = "";
  autosizeTextarea(elements);
  state.activeChatId = renderChats(elements, [], "");
  setUpdatesCount(elements, 0);
  setAuthMode();
  resetAuthInput();
  renderMessages(elements, []);
  renderLibrary();
  renderMapMarkers();
  syncTabs();
  showAuthOverlay(elements);
  syncComposer();
  setStatus(elements, "Локальное хранилище очищено.");
}

function handleSettingsClick() {
  showLockedScreen();
  setStatus(elements, "Экран входа открыт.");
}

function handleTabClick(event) {
  const button = event.target.closest("[data-tab]");

  if (!button) {
    return;
  }

  state.activeTab = button.dataset.tab || "chat";
  syncTabs();

  if (state.activeTab === "map") {
    renderMapMarkers();
  }

  if (state.activeTab === "map" && state.mapInstance) {
    window.setTimeout(() => {
      state.mapInstance.resize();
    }, 60);
  }
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
  syncTabs();
  renderLibrary();
  renderMapMarkers();

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
  elements.mapDrawerClose.addEventListener("click", closeMapDrawer);
  elements.settingsButton.addEventListener("click", handleSettingsClick);
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", handleTabClick);
  });
  elements.tokenInput.addEventListener("input", () => {
    setAuthMode();
    resetAuthInput();
  });
  elements.wipeButton.addEventListener("click", handleWipe);
  document.getElementById("chat-form").addEventListener("submit", handleSendMessage);
}

init();
