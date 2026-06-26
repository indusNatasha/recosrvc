import { runSecureLogin } from './secure/initSecure.js';

const statusTextEl = document.getElementById('status-text');
const retryBtnEl = document.getElementById('retry-btn');
// Навешиваем событие на кнопку
retryBtnEl.addEventListener('click', runSecureLogin);

// Запуск при полной готовности Телеграма
window.Telegram.WebApp.ready();

runSecureLogin(statusTextEl, retryBtnEl);
