# Что ломается на интенсиве и как чинить

Сначала найди симптом в таблицах, потом действуй. Человеку объясняй простыми словами,
что случилось, — одной фразой, без кодов ошибок.

## Компьютер и терминал

| Симптом | Причина | Что делать |
|---|---|---|
| `npm.ps1 cannot be loaded`, «выполнение сценариев отключено» | PowerShell в Windows блокирует npm | Человек выполняет `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, отвечает `Y`. Или переключает терминал на Command Prompt |
| `node: command not found` / `'node' is not recognized` | Node.js не стоит или VS Code не перезапущен после установки | Поставить LTS с nodejs.org, **полностью** закрыть и открыть VS Code |
| `EACCES: permission denied` при установке | Пытались поставить глобально | Ставить внутрь проекта: `npm install --save-dev firebase-tools`, запускать `npx firebase …` |
| `npm create vite` пишет «Operation cancelled» | Создавали проект прямо в непустой папке | Создавать во временную папку `vite-tmp` и переносить, как в части 2.1 |

## Вход в Firebase из терминала

| Симптом | Причина | Что делать |
|---|---|---|
| `npx firebase login` ничего не открывает или висит | Браузер не открылся сам / блокирует localhost | Ctrl+C, затем `npx firebase login --no-localhost`: появится ссылка, человек открывает её, входит, копирует код обратно в терминал |
| `Already logged in as …`, но это не тот аккаунт | Ранее входили другим аккаунтом | `npx firebase logout`, затем `npx firebase login` |
| В `npx firebase projects:list` нет нужного проекта | В терминале и в консоли разные Google-аккаунты | `npx firebase login:list` — посмотреть, кто вошёл. Не тот — `logout` и `login` нужным |
| `Failed to get Firebase project ID-…` / `403` / `Permission denied` при deploy | Неверный ID в `.firebaserc` или чужой аккаунт | Сверить ID с Project settings, проверить `login:list` |
| `Error: Failed to authenticate, have you run firebase login?` | Вход не выполнен в этом терминале | Человек запускает `npx firebase login` сам |

Команду `firebase login` запускает **человек** в своём терминале — она интерактивная.

## Публикация

| Симптом | Причина | Что делать |
|---|---|---|
| На `web.app` «Site Not Found» | Ещё ни разу не опубликовали или публикуется в другой проект | `npm run deploy`, сверить ID в выводе |
| На `web.app` пустая белая страница | Нет `.env.local` при сборке → Firebase не инициализировался; или `public` не `dist` | Проверить `.env.local`, `firebase.json` → `"public": "dist"`, пересобрать |
| Прямая ссылка на внутреннюю страницу — 404 | Нет перенаправления на `index.html` | В `firebase.json` правило `rewrites` на `/index.html` |
| Старая версия после публикации | Кэш браузера | Обновить с Ctrl+Shift+R (Cmd+Shift+R) |
| `firestore: … database (default) does not exist` при deploy | База Firestore не создана | Блок 4 в `firebase-console.md` |

## Вход через Google

| Код / симптом | Причина | Что делать |
|---|---|---|
| `auth/configuration-not-found` | В Authentication не нажали «Get started» | Блок 3, пункт 2 |
| `auth/operation-not-allowed` | Провайдер Google не включён или не сохранён | Блок 3: Enable + почта поддержки + Save, проверить статус «Enabled» |
| Кнопка Save в настройках Google не нажимается | Не выбрана почта поддержки | Выбрать Project support email |
| `auth/unauthorized-domain` | Адрес не в списке разрешённых | Открывать `localhost`, а не `127.0.0.1`. На `web.app` — проверить Authorized domains, добавить `ID-ПРОЕКТА.web.app` |
| `auth/popup-blocked` | Браузер заблокировал окно | Разрешить всплывающие окна для сайта (значок в адресной строке). Вход вызывать прямо по нажатию кнопки, без `await` перед `signInWithPopup` |
| Окно входа открывается и сразу закрывается, вход не происходит | Использован `signInWithRedirect` или поменян `authDomain` | Только `signInWithPopup`, `authDomain` = `ID-ПРОЕКТА.firebaseapp.com` |
| `auth/invalid-api-key` / `auth/api-key-not-valid` | Ошибка в `.env.local` или Vite не перезапущен | Сверить значения через `npx firebase apps:sdkconfig WEB`, перезапустить `npm run dev` |
| `auth/network-request-failed` | Нет интернета, VPN или блокировщик рекламы | Выключить блокировщик/VPN, попробовать другой браузер |
| «Доступ заблокирован: … ошибка 403 access_denied» в окне Google | Рабочий аккаунт Google Workspace запрещает сторонние приложения | Войти личным @gmail.com |
| В окне Google написано «Войти в project-123456» | Не задано публичное название | Authentication → Sign-in method → Google → Public-facing name. Косметика, можно отложить |

После любой правки в консоли Firebase подождать минуту и обновить страницу.
После правки `.env.local` — перезапустить `npm run dev` и заново `npm run deploy`.

## База данных

| Симптом | Причина | Что делать |
|---|---|---|
| `Missing or insufficient permissions` | Правила не совпадают с путём/полями в коде, или правила не опубликованы | Сверить путь коллекции в коде и в `firestore.rules`, сверить список полей в `hasOnly`, `npm run deploy` |
| То же, но только в варианте C у клиента | Клиент читает без фильтра по `ownerId` | Добавить `where("ownerId", "==", uid)` |
| `Failed to get document because the client is offline` | База не создана, или блокировщик рекламы режет запросы | Проверить, что Firestore создана; выключить блокировщик |
| `The query requires an index` + ссылка | Запрос с фильтром и сортировкой по разным полям | Открыть ссылку из ошибки, нажать «Create index», подождать пару минут. Или убрать сортировку и сортировать на странице |
| Запись не появляется после обновления | Сохранение не дожидалось ответа или упало молча | Обернуть в try/catch, показать текст ошибки из DESIGN.md |
| `Quota exceeded` | Израсходован бесплатный лимит за сутки (обычно бесконечный цикл чтений) | Найти чтение внутри `useEffect` без зависимостей; лимит обнулится сам на следующие сутки |

## Если ничего не помогло

Не меняй стек и не открывай правила «чтобы заработало». Скажи человеку, что
застряли, и предложи позвать ведущего. Покажи ему: что делали, точный текст ошибки
(без ключей), что уже пробовали.
