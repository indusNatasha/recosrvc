import { initBiometric, authenticateUser } from './biometric.js';

const statusText = document.getElementById('status-text');
const retryBtn = document.getElementById('retry-btn');

function runSecureLogin() {
    statusText.innerText = "Проверка сканера...";
    retryBtn.style.display = "none";

    initBiometric(
        // onReady
        () => {
            statusText.innerText = "Приложите палец или посмотрите в камеру...";
            
            authenticateUser(
                // onSuccess
                (bioToken) => {
                    statusText.innerText = "Успешно! Доступ разрешен.";
                    console.log("Получен токен биометрии:", bioToken);
                    
                    // Прячем экран загрузки — открывается черная песочница под карту
                    document.getElementById('loading-screen').style.display = 'none';
                },
                // onError сканирования
                (err) => {
                    statusText.innerText = err;
                    retryBtn.style.display = "block"; // Показываем кнопку «Войти снова»
                }
            );
        },
        // onError инициализации
        (err) => {
            statusText.innerText = "Ошибка: " + err;
        }
    );
}

// Вешаем повторную попытку на кнопку
retryBtn.addEventListener('click', runSecureLogin);

// Сообщаем Телеграму, что статика загружена, и стартуем
window.Telegram.WebApp.ready();
runSecureLogin();
