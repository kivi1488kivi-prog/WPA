# ✅ Чеклист: Cloudflare Pages Deployment

## 📦 Что я создал для тебя:

- ✅ **wrangler.toml** - конфиг для Cloudflare Pages
- ✅ **QUICK_START_DEPLOY.md** - быстрый старт за 5 минут
- ✅ **CLOUDFLARE_DEPLOY.md** - полный подробный гайд (7000+ слов)
- ✅ **DOMAIN_SETUP.md** - гайд по подключению domene termin.quest
- ✅ **deploy.ps1** - автоматический скрипт деплоя

## 🎯 Что нужно сделать ТЫ:

### Фаза 1: Регистрация на Cloudflare (5 мин)

- [ ] Перейти на https://dash.cloudflare.com
- [ ] Зарегистрироваться ИЛИ залогиниться
- [ ] Запомнить свой **Account ID**

### Фаза 2: Первый деплой (5 мин)

Выбери **ОДИН** способ:

#### Способ A: Скрипт (рекомендуется)
```powershell
cd C:\Users\maxte\Downloads\barbershop\barbershop\barbershop
.\deploy.ps1
```

#### Способ B: Вручную
```bash
cd C:\Users\maxte\Downloads\barbershop\barbershop\barbershop
npx wrangler login
npm run build
npx wrangler pages publish dist/ --project-name barbershoptestweb
```

**После деплоя:**
- [ ] Ты увидишь URL типа: `https://barbershoptestweb.[ID].pages.dev`
- [ ] Открой этот URL в браузере
- [ ] Проверь что PWA загружается правильно

### Фаза 3: Подключение домена (10-30 мин + 2-48 часов ожидания DNS)

- [ ] Прочитай [DOMAIN_SETUP.md](./DOMAIN_SETUP.md)
- [ ] Определи где купил домен termin.quest
- [ ] Следуй инструкциям для своего регистратора
- [ ] Добавь custom domain в Cloudflare Pages
- [ ] Жди распространения DNS (может быть 2-48 часов)

### Фаза 4: Оптимизация (опционально, 10 мин)

- [ ] Включи кеширование в Cloudflare
- [ ] Включи Brotli сжатие
- [ ] Включи минификацию JS/CSS
- [ ] Включи Email Routing (если нужен email с домена)

## 📚 Файлы для чтения:

1. **Я не знаю как это работает:**
   → Прочитай [CLOUDFLARE_DEPLOY.md](./CLOUDFLARE_DEPLOY.md) (полный гайд на русском)

2. **Я только хочу деплоить:**
   → Прочитай [QUICK_START_DEPLOY.md](./QUICK_START_DEPLOY.md) (5 минут)

3. **Я хочу подключить домен:**
   → Прочитай [DOMAIN_SETUP.md](./DOMAIN_SETUP.md) (пошаговый гайд для каждого регистратора)

## 🔑 Информация которая тебе может понадобиться:

### Для Cloudflare Pages:

```
Project name: barbershoptestweb
Build output: dist/
Build command: npm run build
```

### Для Supabase:

Нужны будут:
- `VITE_SUPABASE_URL` (найди в https://supabase.com → твой проект → Settings → API)
- `VITE_SUPABASE_ANON_KEY` (рядом)

### Для домена:

- Домен: `termin.quest`
- Где куплен: ??? (ты знаешь лучше 😄)

## ⚠️ Важные моменты:

1. **Account ID** - найди в https://dash.cloudflare.com справа внизу
2. **Wrangler login** - делай от пользователя что админ на Cloudflare
3. **dist папка** - уже готова, не трогай
4. **HTTPS** - Cloudflare добавляет автоматически
5. **SPA routing** - уже настроен в `dist/_redirects`
6. **PWA** - уже настроена в конфиге

## 🚨 Если что-то не работает:

### Ошибка: "Project does not exist"

Решение:
```bash
npx wrangler pages project create barbershoptestweb --production-branch main
```

### Ошибка: "Not authenticated"

Решение:
```bash
npx wrangler login
```

### Ошибка: "404 Not Found"

Решение: dist/_redirects уже содержит правильный конфиг, но проверь что есть такой файл.

### Домен не работает

- Жди 24-48 часов на распространение DNS
- Проверь что NS изменены в регистраторе
- Прочитай раздел "Если что-то не работает" в DOMAIN_SETUP.md

## 🎓 Что я создал и почему:

| Файл | Зачем |
|------|-------|
| wrangler.toml | Конфиг для Wrangler/Cloudflare |
| deploy.ps1 | Скрипт на PowerShell для быстрого деплоя |
| QUICK_START_DEPLOY.md | Если ты не хочешь читать много |
| CLOUDFLARE_DEPLOY.md | Полный гайд со всеми деталями |
| DOMAIN_SETUP.md | Инструкции для 10+ регистраторов |
| DEPLOY_CHECKLIST.md | Этот файл - твой план действий |

## 🚀 Готов? Давай!

```powershell
# Вариант 1: Скрипт (проще)
.\deploy.ps1

# Вариант 2: Вручную (если что-то не так)
npx wrangler login
npm run build
npx wrangler pages publish dist/ --project-name barbershoptestweb
```

После первого деплоя → читай DOMAIN_SETUP.md для подключения domene.

---

**Удачи с деплоем!** 🎉

Если будут вопросы - всё описано в файлах. Начни с QUICK_START_DEPLOY.md или CLOUDFLARE_DEPLOY.md.
