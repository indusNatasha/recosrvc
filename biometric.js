// Проверяем, запущен ли код внутри Телеграма и доступно ли вообще WebApp API
const tg = window.Telegram?.WebApp;
const manager = tg?.BiometricManager;

/**
 * ИНИЦИАЛИЗАЦИЯ И ПРОВЕРКА ДОСТУПА.
 * Проверяет железо и запрашивает разрешение на биометрию, если его нет.
 * @param {Function} onReady - функция, которая выполнится, если биометрия полностью готова к работе
 * @param {Function} onError - функция, которая выполнится в случае ошибки (нет сканера, отказ и т.д.)
 */
export const initBiometric = (onReady, onError) => {
    if (!manager) {
        onError("AAA Error: Telegram Biometric API не найден. Откройте Mini App внутри Телеграма!");
        return;
    }

    // Внутренний помощник, чтобы не дублировать код проверки железа
    const verifyHardware = () => {
        // Шаг 1: Есть ли вообще сканер на телефоне и включен ли он в ОС?
        if (!manager.isBiometricAvailable) {
            onError("На устройстве нет сканера отпечатков/лица, либо он отключен.");
            return;
        }

        // Шаг 2: Давал ли уже юзер разрешение нашему боту?
        if (!manager.isAccessGranted) {
            // Если нет — просим разрешение через нативное окно
            manager.requestAccess({ reason: "Доступ нужен для генерации крипто-ключей базы данных." }, (granted) => {
                if (granted) onReady(); // Юзер разрешил!
                else onError("Пользователь запретил боту использовать биометрию.");
            });
        } else {
            // Разрешение уже есть, всё отлично
            onReady();
        }
    };

    // Если Телеграм уже связался с железом смартфона, проверяем сразу
    if (manager.isInited) {
        verifyHardware();
    } else {
        // Если нет — ждем, пока Телеграм закончит инициализацию менеджера
        manager.init(() => {
            verifyHardware();
        });
    }
};

/**
 * СКАНИРОВАНИЕ: Показывает окно FaceID/TouchID и возвращает секретный токен.
 * @param {Function} onSuccess - выполнится при успешном сканировании, принимает (biometricToken)
 * @param {Function} onError - выполнится, если личность не подтверждена
 */
export const authenticateUser = (onSuccess, onError) => {
    if (!manager) {
        onError("Biometric API не инициализировано.");
        return;
    }

    const authParams = { 
        reason: "Приложите палец или посмотрите в камеру для расшифровки локального сейфа." 
    };

    // Просто вызываем нативный сканер и передаем результаты напрямую в коллбэки
    manager.authenticate(authParams, (success, biometricToken) => {
        if (success) {
            onSuccess(biometricToken); // Успех! Передаем токен для cryptoCore.js
        } else {
            onError("Ошибка биометрии. Личность не подтверждена.");
        }
    });
};
