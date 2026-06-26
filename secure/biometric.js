// Забираем глобальные объекты, которые Телеграм инжектит в WebView смартфона
const tg = window.Telegram?.WebApp;
const manager = tg?.BiometricManager;

/**
 * ИНИЦИАЛИЗАЦИЯ: Будим биометрический менеджер Телеграма.
 * Проверяет железо и запрашивает разрешение, если его еще нет.
 */
export function initBiometric(onReady, onError) {
    if (!manager) {
        onError("Telegram Biometric API не найден. Запустите внутри бота!");
        return;
    }

    // Внутренний помощник для проверки физического наличия сканера
    function verifyHardware() {
        // Шаг 1: Есть ли вообще сканер на телефоне и включен ли он в ОС?
        if (!manager.isBiometricAvailable) {
            onError("На этом устройстве нет сканера, либо он отключен в настройках ОС.");
            return;
        }

        // Шаг 2: Давал ли уже юзер разрешение нашему боту?
        if (!manager.isAccessGranted) {
            // Если нет — просим разрешение через нативное окно
            manager.requestAccess({ reason: "Доступ нужен для генерации локальных ключей шифрования." }, function(granted) {
                if (granted) {
                    onReady(); // Юзер разрешил!
                } else {
                    onError("Вы запретили боту использовать биометрию.");
                }
            });
        } else {
            // Разрешение уже есть, всё отлично
            onReady();
        }
    }

    // Если Телеграм уже связался с железом смартфона, проверяем сразу
    if (manager.isInited) {
        verifyHardware();
    } else {
        // Если нет — ждем, пока Телеграм закончит инициализацию менеджера
        manager.init(function() {
            verifyHardware();
        });
    }
}

/**
 * СКАНИРОВАНИЕ: Вызывает шторку FaceID/TouchID и возвращает токен.
 */
export function authenticateUser(onSuccess, onError) {
    if (!manager) {
        onError("Biometric API не инициализировано.");
        return;
    }

    const authParams = { 
        reason: "Подтвердите личность для расшифровки локальной базы данных." 
    };

    // Вызываем нативный сканер операционной системы смартфона
    manager.authenticate(authParams, function(success, biometricToken) {
        if (success) {
            onSuccess(biometricToken); // Возвращаем секретную строку от ТГ для CryptoCore
        } else {
            onError("Личность не подтверждена. Попробуйте еще раз.");
        }
    });
}
