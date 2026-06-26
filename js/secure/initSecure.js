import { initBiometric, authenticateUser } from "./biometric";


export function runSecureLogin(statusTextEl, retryBtnEl) {
    
    statusTextEl.innerText = "Проверка сканера...";
    retryBtnEl.style.display = "none";

    // Шаг 1: Инициализируем биометрию
    initBiometric(
        // Колбэк, если всё готово (onReady)
        function() {
            statusTextEl.innerText = "Приложите палец или посмотрите в камеру...";
            
            // Шаг 2: Вызываем сканер
            authenticateUser(
                // Колбэк при успешном сканировании (onSuccess)
                function(bioToken) {
                    statusTextEl.innerText = "Успешно! Доступ разрешен.";
                    console.log("Получен токен биометрии:", bioToken);
                    
                    // Прячем экран загрузки
                    document.getElementById('loading-screen').style.display = 'none';
                },
                // Колбэк, если юзер приложил чужой палец или закрыл окно (onError)
                function(err) {
                    statusTextEl.innerText = err;
                    retryBtnEl.style.display = "block";
                }
            );
        },
        // Колбэк, если на телефоне вообще нет биометрии (onError)
        function(err) {
            statusTextEl.innerText = "Ошибка: " + err;
        }
    );
}