import { fail, ok } from "./helpers.js";

export const ENCRYPTED_TOKEN_KEY = "encryptedBotToken";
export const POLL_OFFSET_KEY = "pollOffset";

const DB_NAME = "mini-app-bot-db";
const DB_VERSION = 1;
const STORE_SETTINGS = "settings";
const STORE_UPDATES = "updates";
const STORE_MESSAGES = "messages";
const STORE_CHATS = "chats";

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORE_UPDATES)) {
        const updatesStore = db.createObjectStore(STORE_UPDATES, { keyPath: "updateId" });
        updatesStore.createIndex("receivedAt", "receivedAt");
      }

      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const messagesStore = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        messagesStore.createIndex("chatId", "chatId");
      }

      if (!db.objectStoreNames.contains(STORE_CHATS)) {
        const chatsStore = db.createObjectStore(STORE_CHATS, { keyPath: "chatId" });
        chatsStore.createIndex("lastMessageAt", "lastMessageAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }

  return dbPromise;
}

export async function getSetting(key) {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const store = tx.objectStore(STORE_SETTINGS);
    const result = await requestToPromise(store.get(key));
    return ok(result ? result.value : null);
  } catch (error) {
    return fail(error);
  }
}

export async function putSetting(key, value) {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const store = tx.objectStore(STORE_SETTINGS);
    store.put({ key, value });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save setting"));
      tx.onabort = () => reject(tx.error || new Error("Settings transaction aborted"));
    });

    return ok(true);
  } catch (error) {
    return fail(error);
  }
}

export async function clearAllStores() {
  try {
    const db = await getDb();
    const tx = db.transaction(
      [STORE_SETTINGS, STORE_UPDATES, STORE_MESSAGES, STORE_CHATS],
      "readwrite"
    );

    tx.objectStore(STORE_SETTINGS).clear();
    tx.objectStore(STORE_UPDATES).clear();
    tx.objectStore(STORE_MESSAGES).clear();
    tx.objectStore(STORE_CHATS).clear();

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to clear IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("Clear transaction aborted"));
    });

    return ok(true);
  } catch (error) {
    return fail(error);
  }
}

export async function getChats() {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_CHATS, "readonly");
    const store = tx.objectStore(STORE_CHATS);
    const chats = await requestToPromise(store.getAll());
    chats.sort((left, right) => (right.lastMessageAt || 0) - (left.lastMessageAt || 0));
    return ok(chats);
  } catch (error) {
    return fail(error);
  }
}

export async function getMessages(chatId) {
  try {
    if (!chatId) {
      return ok([]);
    }

    const db = await getDb();
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const index = tx.objectStore(STORE_MESSAGES).index("chatId");
    const records = await requestToPromise(index.getAll(IDBKeyRange.only(chatId)));
    records.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    return ok(records);
  } catch (error) {
    return fail(error);
  }
}

export async function getAllMessages() {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const records = await requestToPromise(store.getAll());
    records.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    return ok(records);
  } catch (error) {
    return fail(error);
  }
}

export async function getUpdatesCount() {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_UPDATES, "readonly");
    const store = tx.objectStore(STORE_UPDATES);
    const count = await requestToPromise(store.count());
    return ok(count);
  } catch (error) {
    return fail(error);
  }
}

export async function getLatestUpdateOffset() {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_UPDATES, "readonly");
    const store = tx.objectStore(STORE_UPDATES);
    const cursor = await requestToPromise(store.openCursor(null, "prev"));
    const nextOffset = cursor ? Number(cursor.key) + 1 : 0;
    return ok(nextOffset);
  } catch (error) {
    return fail(error);
  }
}

export async function saveUpdates(updates, messages, nextOffset) {
  try {
    const db = await getDb();
    const tx = db.transaction(
      [STORE_UPDATES, STORE_MESSAGES, STORE_CHATS, STORE_SETTINGS],
      "readwrite"
    );
    const updatesStore = tx.objectStore(STORE_UPDATES);
    const messagesStore = tx.objectStore(STORE_MESSAGES);
    const chatsStore = tx.objectStore(STORE_CHATS);
    const settingsStore = tx.objectStore(STORE_SETTINGS);

    updates.forEach((update) => {
      updatesStore.put({
        updateId: Number(update.update_id),
        receivedAt: Date.now(),
        payload: update,
      });
    });

    messages.forEach((message) => {
      messagesStore.put(message);
      chatsStore.put({
        chatId: message.chatId,
        chatTitle: message.chatTitle,
        chatType: message.chatType,
        lastMessageAt: message.createdAt,
        lastPreview: message.text.slice(0, 120),
      });
    });

    settingsStore.put({ key: POLL_OFFSET_KEY, value: nextOffset });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save updates"));
      tx.onabort = () => reject(tx.error || new Error("Updates transaction aborted"));
    });

    return ok(true);
  } catch (error) {
    return fail(error);
  }
}

export async function saveOutgoingMessage(message) {
  try {
    const db = await getDb();
    const tx = db.transaction([STORE_MESSAGES, STORE_CHATS], "readwrite");
    const messagesStore = tx.objectStore(STORE_MESSAGES);
    const chatsStore = tx.objectStore(STORE_CHATS);

    messagesStore.put(message);
    chatsStore.put({
      chatId: message.chatId,
      chatTitle: message.chatTitle,
      chatType: message.chatType,
      lastMessageAt: message.createdAt,
      lastPreview: message.text.slice(0, 120),
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to save outgoing message"));
      tx.onabort = () => reject(tx.error || new Error("Outgoing transaction aborted"));
    });

    return ok(true);
  } catch (error) {
    return fail(error);
  }
}
