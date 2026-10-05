# 🚀 Полный гайд: Деплой на Cloudflare Pages

## 📌 Предусловия

✅ Node.js v24+ установлен  
✅ npm установлен  
✅ Wrangler CLI v4.147.0+ установлен  
✅ Домен куплен (termin.quest/)  
✅ dist папка готова  

---

## 🔑 Шаг 1: Создай аккаунт на Cloudflare

1. Перейди на https://dash.cloudflare.com
2. Зарегистрируйся или залогинься
3. Запомни свой **Account ID** (найди в профиле → Account Home → справа внизу "Account ID")

---

## 📋 Шаг 2: Подготовка локального окружения

### 2.1 Логин в Wrangler

```bash
npx wrangler login
```

Откроется браузер, разреши доступ. Wrangler сохранит токен локально.

### 2.2 Убедись что dist папка актуальна

```bash
npm run build
```

Это создаст/обновит папку `dist/` с собранным приложением.

### 2.3 Проверь что build прошёл успешно

```bash
ls dist/
```

Должны быть файлы: `index.html`, папки `assets/`, `service-worker/`, и т.д.

---

## 🌐 Шаг 3: Создай Pages Project на Cloudflare

### Вариант A: Создать через Wrangler (для локального деплоя)

```bash
npx wrangler pages project create barbershoptestweb --production-branch main
```

**Ответы на вопросы:**
- Build command: `npm run build`
- Build output directory: `dist`

### Вариант B: Создать через веб-интерфейс (опционально)

Если хочешь всё сделать в браузере:
1. Зайди в https://dash.cloudflare.com
2. Слева → **Pages**
3. **Create project** → **Deploy with direct upload**
4. Наз­ови проект: `barbershoptestweb`
5. Загрузи папку `dist/`

---

## 📤 Шаг 4: Деплой на Cloudflare Pages

### Вариант A: Прямой деплой папки dist (РЕКОМЕНДУЕТСЯ - быстро)

```bash
npx wrangler pages publish dist/ --project-name barbershoptestweb
```

**Ответы:**
- Выбери аккаунт если спросит
- Дождись завершения

✅ После деплоя ты увидишь URL: `https://barbershoptestweb.[ID].pages.dev`

### Вариант B: Автоматический деплой (через CI)

Если хочешь чтобы Cloudflare сам собирал и деплоил:

1. Залей проект на GitHub (опционально)
2. В Cloudflare Pages project settings:
   - Production branch: `main`
   - Build command: `npm run build`
   - Build output: `dist`
   - Environment: добавь `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`

---

## 🎯 Шаг 5: Привяжи домен termin.quest

### 5.1 Скажи Cloudflare про домен

Cloudflare работает по-разному в зависимости от где ты купил домен:

#### Если домен куплен у Cloudflare:
1. Зайди в **Websites** → **Add site**
2. Введи: `termin.quest`
3. Cloudflare скажет: "Already registered with Cloudflare"
4. Выбери план (Free план подходит)
5. Cloudflare изменит NS автоматически

#### Если домен куплен где-то ещё (namecheap, godaddy, registrar.ru и т.д.):
1. Зайди в **Websites** → **Add site**
2. Введи: `termin.quest`
3. Выбери план (Free нормально)
4. Cloudflare даст тебе **2 nameserver**:
   - `victoria.ns.cloudflare.com`
   - `wyatt.ns.cloudflare.com`
5. Зайди в **регистратор домена** (где ты купил):
   - Найди **DNS settings** или **Nameservers**
   - Замени текущие NS на Cloudflare NS
   - Сохрани (может занять 2-48 часов)

### 5.2 Привяжи Pages project к домену

1. Зайди в **Pages** → **barbershoptestweb** → **Settings**
2. Слева → **Custom domains**
3. Нажми **Set up custom domain**
4. Введи: `termin.quest` (без www для apex домена)
   - Для www версии: добавь отдельно `www.termin.quest`
5. Cloudflare создаст CNAME запись автоматически

---

## 🔐 Шаг 6: Настрой переменные окружения

### На Cloudflare:

1. Зайди в **Pages** → **barbershoptestweb** → **Settings** → **Environment variables**
2. Добавь переменные (для всех environment):

| Переменная | Значение | Где взять |
|-----------|----------|-----------|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` | Supabase project settings |
| `VITE_SUPABASE_ANON_KEY` | твой anon key | Supabase project settings → API → anon key |
| `VITE_FUNCTIONS_URL` | (опционально) | Supabase functions URL |
| `VITE_VAPID_PUBLIC_KEY` | (опционально) | Если используешь push notifications |

**Где взять Supabase ключи:**
1. Зайди в https://supabase.com
2. Выбери свой проект
3. Settings → API → в разделе Project API keys найди:
   - `URL` → скопируй
   - `anon public` → скопируй
4. Верни значения на Cloudflare

---

## 🚀 Полный чеклист деплоя

```bash
# 1. Убедись что находишься в папке проекта
cd C:\Users\maxte\Downloads\barbershop\barbershop\barbershop

# 2. Логин в Wrangler
npx wrangler login

# 3. Собери приложение
npm run build

# 4. Проверь что dist готов
dir dist

# 5. Деплой
npx wrangler pages publish dist/ --project-name barbershoptestweb

# 6. Жди завершения - ты увидишь URL деплоя!
```

---

## 🔍 Проверка статуса деплоя

```bash
# Посмотри статус деплоя
npx wrangler pages deployments list --project-name barbershoptestweb

# Посмотри логи последнего деплоя
npx wrangler pages deployments rollback --project-name barbershoptestweb
```

---

## 🐛 Если что-то не работает

### Проблема: "Not found" ошибка 404

**Решение:** Cloudflare Pages нужен fallback на index.html для SPA:

1. Зайди в Pages project → **Settings**
2. Найди **Build settings** или **Functions**
3. Создай файл `_redirects` в корне проекта (или dist):

```
/*    /index.html   200
```

Или используй `_headers` файл:

```
/*.css
  Cache-Control: max-age=31536000

/*.js
  Cache-Control: max-age=31536000

/*.woff2
  Cache-Control: max-age=31536000

/index.html
  Cache-Control: max-age=0
```

### Проблема: Supabase ключи не работают

Проверь:
1. VITE_SUPABASE_URL начинается с `https://`
2. Ключи скопированы полностью (без пробелов)
3. Переменные установлены в **Environment variables**, не в secrets
4. Нужно пересобрать и переделоить: `npm run build && npx wrangler pages publish dist/`

### Проблема: Домен не работает

1. Проверь NS в регистраторе - должны быть Cloudflare NS
2. Жди 24-48 часов пока NS распространятся
3. Проверь: `nslookup termin.quest`
4. Зайди в Cloudflare → Websites → termin.quest → DNS → проверь что CNAME есть для Pages

### Проблема: CORS ошибки

Проверь в Supabase:
1. Settings → API → CORS settings
2. Добавь свой домен: `https://termin.quest`

---

## 🎉 Что дальше?

После успешного деплоя:

1. **Проверь что работает:**
   ```bash
   curl https://barbershoptestweb.[ID].pages.dev
   ```

2. **Тестирование на мобильном:**
   - Открой PWA на мобильном браузере
   - Нажми "Add to Home Screen"

3. **Оптимизация:**
   - Включи Cloudflare caching
   - Включи автоматический HTTPS (по умолчанию включён)
   - Включи Cloudflare Analytics для отслеживания

4. **CI/CD (если захочешь автоматизировать):**
   - Загрузи на GitHub
   - Cloudflare Pages автоматически деплоит при push

---

## 📞 Полезные ссылки

- [Cloudflare Pages docs](https://developers.cloudflare.com/pages/)
- [Wrangler CLI docs](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [Supabase API Reference](https://supabase.com/docs/guides/api)
- [Domain setup guide](https://developers.cloudflare.com/fundamentals/setup/manage-domains/)

---

**Если всё прошло успешно:** поздравляю! 🎊 Твой barbershop PWA теперь live на Cloudflare Pages!
