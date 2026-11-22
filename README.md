# RubUp — запуск через GitHub → Render + база Neon (всё с телефона)

## 1. База (Neon)
neon.tech → создайте проект → на главной нажмите **Connect** → скопируйте строку `postgresql://...`.
Таблицы создавать не нужно, сервер сделает всё сам.

## 2. GitHub
Распакуйте архив. На github.com создайте репозиторий (New) → **Add file → Upload files** →
загрузите `server.js`, `index.html`, `package.json` (остальное по желанию) → Commit.

## 3. Render
render.com → **New → Web Service** → выберите репозиторий.
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment (переменные):
  - `BOT_TOKEN` — новый токен из BotFather
  - `ADMIN_IDS` — ваш Telegram ID (узнать: бот @userinfobot)
  - `DATABASE_URL` — строка из Neon

Нажмите Deploy. Когда в логах появится `webhook: true` — всё готово: откройте бота, /start.
Кнопка «Играть» в меню бота ставится автоматически.

## Вывод
Заявка приходит вам в бота: `/wd` — список, `/done N` — выплачено, `/reject N` — вернуть на баланс.

## Важно
- Бесплатный тариф Render засыпает через 15 минут без заходов — первый вход после паузы грузится ~30–50 секунд. Для реальной работы берите платный.
- Если у платформы свой адрес API вместо api.telegram.org — добавьте переменную `API_BASE`.
