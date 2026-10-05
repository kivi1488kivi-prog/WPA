# ⚡ Quick Start: Деплой за 5 минут

## 🚀 Самый быстрый способ

### 1️⃣ Логинься в Wrangler

```bash
npx wrangler login
```

Откроется браузер. Залогинься в Cloudflare, разреши доступ.

### 2️⃣ Собери приложение

```bash
npm run build
```

### 3️⃣ Деплой в один клик

```bash
npx wrangler pages publish dist/ --project-name barbershoptestweb
```

**Готово!** Ты увидишь URL:
```
https://barbershoptestweb.[ID].pages.dev
```

---

## 📋 Или используй скрипт (ещё проще)

```powershell
.\deploy.ps1
```

Скрипт сделает все 3 шага автоматически.

---

## 🎯 Что дальше?

1. ✅ Открой URL из консоли в браузере
2. ✅ Проверь что PWA загружается
3. ✅ Читай [DOMAIN_SETUP.md](./DOMAIN_SETUP.md) для подключения домена termin.quest
4. ✅ Читай [CLOUDFLARE_DEPLOY.md](./CLOUDFLARE_DEPLOY.md) для полной конфигурации

---

## ❓ Если не знаешь что делать

**Читай в этом порядке:**

1. **Первый раз?** → [CLOUDFLARE_DEPLOY.md](./CLOUDFLARE_DEPLOY.md) - полный гайд
2. **Подключить домен?** → [DOMAIN_SETUP.md](./DOMAIN_SETUP.md) - гайд по домену
3. **Что-то сломалось?** → Конец CLOUDFLARE_DEPLOY.md (раздел 🐛 Если что-то не работает)

---

**Готово к деплою? Вперёд!** 🚀
