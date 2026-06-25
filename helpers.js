export const EMOJI_KEY_LENGTH = 4;

export const EMOJI_ALPHABET = [
  { id: "sun", emoji: "☀️", word: "aurora" },
  { id: "moon", emoji: "🌙", word: "luna" },
  { id: "wave", emoji: "🌊", word: "tidal" },
  { id: "flame", emoji: "🔥", word: "ember" },
  { id: "leaf", emoji: "🍀", word: "clover" },
  { id: "apple", emoji: "🍎", word: "orchard" },
  { id: "balloon", emoji: "🎈", word: "helium" },
  { id: "dice", emoji: "🎲", word: "chance" },
  { id: "gem", emoji: "💎", word: "prism" },
  { id: "rocket", emoji: "🚀", word: "vector" },
  { id: "star", emoji: "⭐", word: "starlight" },
  { id: "cloud", emoji: "☁️", word: "cirrus" },
];

export function ok(data = null, status = "ok") {
  return { data, error: null, status };
}

export function fail(error, status = "error", data = null) {
  return { data, error, status };
}

export function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatUnixTime(seconds) {
  return formatTime(new Date(seconds * 1000));
}

export function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function getEmojiById(id) {
  return EMOJI_ALPHABET.find((item) => item.id === id) || null;
}

export function sameSequence(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function buildEmojiSecret(sequence) {
  const words = sequence.map((id) => {
    const item = getEmojiById(id);
    return item ? item.word : id;
  });

  return `emoji-v1::${words.join("::")}`;
}

export function bytesToBase64(bytes) {
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window.btoa(binary);
}

export function base64ToBytes(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function log(event, details = {}) {
  console.log("[miniAppBot]", event, details);
}
