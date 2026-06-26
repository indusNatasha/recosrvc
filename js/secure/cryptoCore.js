const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Превращает мастер-токен (из биометрии Телеграма) в полноценный крипто-ключ.
 * Используем алгоритм PBKDF2 для растяжения строки в надежный 256-битный ключ.
 */
export async function deriveKey(masterToken) {
    const encoder = new TextEncoder();
    
    // Шаг 1: Загружаем сырые текстовые байты токена в крипто-движок браузера
    const baseKey = await window.crypto.subtle.importKey(
        'raw', 
        encoder.encode(masterToken), 
        'PBKDF2', 
        false, 
        ['deriveKey']
    );
    
    // Шаг 2: Прогоняем хэш через 100 000 итераций SHA-256 для защиты от брутфорса
    return await window.crypto.subtle.deriveKey(
        { 
            name: 'PBKDF2', 
            salt: new Uint8Array(), // Для простоты учебного проекта соль пока пустая
            iterations: 100000, 
            hash: 'SHA-256' 
        },
        baseKey,
        { name: ALGO, length: KEY_LENGTH },
        false, // extractable: false намертво запирает ключ внутри движка без возможности кражи скриптом
        ['encrypt', 'decrypt']
    );
}

/**
 * Шифрует обычную строку (например, JSON с метками карт или токен бота) с помощью ключа.
 * На выходе выдает безопасную Base64 строку.
 */
export async function encryptText(plainText, cryptoKey) {
    const encoder = new TextEncoder();
    
    // Вектор инициализации (IV) — 12 случайных байт, обязательных для защиты алгоритма AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Само шифрование данных
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: ALGO, iv: iv }, 
        cryptoKey, 
        encoder.encode(plainText)
    );
    
    // Склеиваем IV и зашифрованные данные вместе в один массив байт, чтобы не потерять IV
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedBuffer), iv.length);
    
    // Переводим бинарный массив в строку Base64 для удобного хранения в IndexedDB
    return btoa(String.fromCharCode(...combined));
}

/**
 * Расшифровывает зашифрованную Base64 строку обратно в понятный текст.
 */
export async function decryptText(base64Ciphertext, cryptoKey) {
    // Декодируем строку Base64 обратно в массив байт
    const binary = atob(base64Ciphertext);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        combined[i] = binary.charCodeAt(i);
    }
    
    // Разрезаем массив обратно: первые 12 байт — это наш IV, остальное — зашифрованный текст
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Расшифровываем бинарные данные в крипто-движке
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: ALGO, iv: iv }, 
        cryptoKey, 
        ciphertext
    );
    
    // Превращаем чистые байты обратно в читаемый текст (или JSON-строку)
    return new TextDecoder().decode(decryptedBuffer);
}
