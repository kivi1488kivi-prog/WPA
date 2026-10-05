# 📋 Как добавить новый барбершоп в систему

## 🎯 Быстрый старт (5 минут)

### 1. Создай папку для нового барбершопа

```bash
mkdir -p tenants/MY-SHOP/{images,images/barbers}
```

Замени `MY-SHOP` на slug барбершопа (только буквы, цифры, дефис).  
Пример: `barber-masters`, `kayan-berlin`, `fades-london`

---

## 📄 Структура файлов

Для каждого барбершопа нужны:

```
tenants/MY-SHOP/
├── business.json           ← основная конфигурация
├── images/
│   ├── logo.png           ← логотип
│   ├── icon.png           ← иконка для приложения
│   ├── icon-maskable.png  ← маскируемая иконка
│   ├── cover.jpg          ← фото обложки
│   └── barbers/
│       ├── ivan.jpg       ← фото барбера 1
│       └── petr.jpg       ← фото барбера 2
```

---

## 🔧 Создание business.json

Это **главный файл** конфигурации. Вот полный шаблон:

```json
{
  "$schema": "../_schema/business.schema.json",
  
  // === ОСНОВНОЕ ===
  "slug": "my-shop",                    // URL path: /s/my-shop/
  "name": "My Premium Barbershop",      // полное название
  "short_name": "My Barber",            // короткое имя
  "tagline": "Classic cuts & style",    // слоган
  "description": "Описание салона...",  // описание (для SEO)
  "locale": "de",                       // язык: de, en, ru
  "timezone": "Europe/Berlin",          // часовой пояс
  "currency": "EUR",                    // валюта: EUR, USD, RUB
  "is_demo": true,                      // демо ли это
  
  // === БРЕНДИНГ ===
  "brand": {
    "accent_color": "#DAA520",          // основной цвет
    "background_color": "#1a1a1a",      // фон
    "logo": "images/logo.png",
    "icon": "images/icon.png",
    "maskable_icon": "images/icon-maskable.png",
    "cover": "images/cover.jpg"         // фото обложки (1200px+ шириной)
  },
  
  // === КОНТАКТЫ ===
  "contact": {
    "phone": "+49 30 12345678",
    "email": "info@example.de"
  },
  
  // === АДРЕС ===
  "location": {
    "address_line": "Straße 123",
    "city": "Berlin",
    "postal_code": "10115",
    "country": "DE"
  },
  
  // === ЧАСЫ РАБОТЫ ===
  "opening_hours": {
    "mon": ["09:00-19:00"],
    "tue": ["09:00-19:00"],
    "wed": ["09:00-19:00"],
    "thu": ["09:00-19:00"],
    "fri": ["09:00-19:00"],
    "sat": ["09:00-18:00"],
    "sun": []                           // выходной
  },
  
  // === ПРАВИЛА ===
  "rules": {
    "slot_step_min": 30,                // длительность слота
    "min_lead_min": 60,                 // минимум за сколько минут можно забронировать
    "max_advance_days": 60,             // максимум на сколько дней вперёд
    "cancellation": {
      "allowed": true,
      "min_notice_hours": 24            // отмена за 24 часа до
    },
    "reschedule": {
      "allowed": true,
      "min_notice_hours": 24,
      "max_per_booking": 3              // максимум переносов
    }
  },
  
  // === УВЕДОМЛЕНИЯ ===
  "notifications": {
    "reminders_before_min": [180, 1440], // напоминания за 3 часа и за 1 день
    "notify_staff": true                // уведомлять сотрудников
  },
  
  // === AI АССИСТЕНТ ===
  "ai": {
    "enabled": false,                   // включить ли AI помощника
    "daily_request_limit": 100,
    "daily_token_limit": 50000
  },
  
  // === УСЛУГИ ===
  "services": [
    {
      "key": "haircut",                 // уникальный ID услуги
      "name": "Haircut",                // название
      "description": "Classic cut with wash",
      "duration_min": 30,               // длительность в минутах
      "price": 25                       // цена
    },
    {
      "key": "beard-trim",
      "name": "Beard Trim",
      "description": "Shape and style",
      "duration_min": 20,
      "price": 15
    }
  ],
  
  // === БАРБЕРЫ ===
  "barbers": [
    {
      "key": "ivan",                    // уникальный ID
      "name": "Ivan",                   // имя
      "title": "Master Barber",         // должность
      "bio": "15 лет опыта...",         // биография
      "photo": "images/barbers/ivan.jpg",
      "specialties": ["Fades", "Beards"], // специализация
      "color": "#DAA520",               // цвет для календаря
      "marker": "IV",                   // 2-буквенный код
      "services": ["haircut", "beard-trim"], // какие услуги оказывает
      
      // расписание (можно разные дни)
      "schedule": {
        "mon": ["09:00-18:00"],
        "tue": ["09:00-18:00"],
        "wed": ["09:00-18:00"],
        "thu": ["09:00-18:00"],
        "fri": ["09:00-18:00"],
        "sat": ["09:00-17:00"]
      },
      
      // перерывы (обеденные и т.д.)
      "breaks": {
        "mon": ["12:00-12:30"],
        "tue": ["12:00-12:30"],
        "wed": ["12:00-12:30"],
        "thu": ["12:00-12:30"],
        "fri": ["12:00-12:30"],
        "sat": ["12:00-12:30"]
      }
    }
  ],
  
  // === ПРАВОВАЯ ИНФОРМАЦИЯ ===
  "legal": {
    "impressum": {
      "legal_name": "My Shop GmbH",
      "represented_by": "Name",
      "street": "Straße 123",
      "postal_code": "10115",
      "city": "Berlin",
      "country": "Deutschland",
      "email": "info@example.de",
      "phone": "+49 30 12345678",
      "dispute_resolution": "not_willing"
    },
    "privacy": {
      "retention_months": 24,
      "hosting": "Supabase (EU, Frankfurt) · Cloudflare Pages",
      "extra_processors": []
    }
  }
}
```

---

## 📷 Требования к изображениям

### Logo & Icons
- **logo.png**: 512x512px (вектор рекомендуется, но PNG OK)
- **icon.png**: 512x512px квадратное
- **icon-maskable.png**: 512x512px (с отступом для маски)

Инструмент для создания: [Maskable.app](https://maskable.app/)

### Cover Image
- **cover.jpg**: минимум 1200px ширину (1200x600 оптимально)
- Формат: JPG, WebP или PNG
- Размер: < 500KB желательно
- Контент: фасад салона, интерьер или команда

### Barber Photos
- **Размер**: 400x400px минимум
- **Формат**: JPG, WebP или PNG
- **Контент**: портрет барбера, желательно в салоне

---

## 🚀 Процесс добавления

### Шаг 1: Создай структуру
```bash
mkdir -p tenants/my-shop/{images,images/barbers}
```

### Шаг 2: Добавь business.json
Скопируй шаблон выше, заполни данные.

### Шаг 3: Загрузи изображения
```bash
cp logo.png tenants/my-shop/images/
cp cover.jpg tenants/my-shop/images/
cp barber1.jpg tenants/my-shop/images/barbers/ivan.jpg
```

### Шаг 4: Пересобери приложение
```bash
npm run build
```

Должен увидеть:
```
✓ shell /s/my-shop/ — успешно!
```

### Шаг 5: Деплой
```bash
npx wrangler pages deploy dist/ --project-name barbershoptestweb
```

### Шаг 6: Проверка
Открой в браузере:
```
https://barbershoptestweb.pages.dev/s/my-shop/
```

---

## 📌 Практический пример: "Fade Masters"

### Файловая структура:
```
tenants/fade-masters/
├── business.json
└── images/
    ├── logo.png
    ├── icon.png
    ├── icon-maskable.png
    ├── cover.jpg
    └── barbers/
        ├── alex.jpg
        ├── mike.jpg
```

### business.json:
```json
{
  "$schema": "../_schema/business.schema.json",
  "slug": "fade-masters",
  "name": "Fade Masters Barbershop",
  "short_name": "Fade Masters",
  "tagline": "Expert fades & modern cuts",
  "description": "Специалисты по фейдам и современным стрижкам",
  "locale": "de",
  "timezone": "Europe/Berlin",
  "currency": "EUR",
  "is_demo": true,
  
  "brand": {
    "accent_color": "#FF6B35",
    "background_color": "#1a1a1a",
    "logo": "images/logo.png",
    "icon": "images/icon.png",
    "maskable_icon": "images/icon-maskable.png",
    "cover": "images/cover.jpg"
  },
  
  "contact": {
    "phone": "+49 30 98765432",
    "email": "hello@fademasters.de"
  },
  
  "location": {
    "address_line": "Kurfürstendamm 42",
    "city": "Berlin",
    "postal_code": "10711",
    "country": "DE"
  },
  
  "opening_hours": {
    "mon": ["10:00-19:00"],
    "tue": ["10:00-19:00"],
    "wed": ["10:00-19:00"],
    "thu": ["10:00-20:00"],
    "fri": ["10:00-20:00"],
    "sat": ["09:00-18:00"]
  },
  
  "rules": {
    "slot_step_min": 30,
    "min_lead_min": 30,
    "max_advance_days": 90,
    "cancellation": { "allowed": true, "min_notice_hours": 12 },
    "reschedule": { "allowed": true, "min_notice_hours": 12, "max_per_booking": 5 }
  },
  
  "notifications": {
    "reminders_before_min": [300, 1440],
    "notify_staff": true
  },
  
  "ai": { "enabled": true, "daily_request_limit": 200, "daily_token_limit": 200000 },
  
  "services": [
    { "key": "fade", "name": "Fade Cut", "description": "Skin fade or high fade", "duration_min": 40, "price": 30 },
    { "key": "line", "name": "Line Up", "description": "Edge lines and cleanup", "duration_min": 20, "price": 15 },
    { "key": "beard", "name": "Beard Design", "description": "Full beard styling", "duration_min": 25, "price": 20 }
  ],
  
  "barbers": [
    {
      "key": "alex",
      "name": "Alex",
      "title": "Head Barber",
      "bio": "10+ years of fade expertise",
      "photo": "images/barbers/alex.jpg",
      "specialties": ["Skin Fades", "Patterns", "Designs"],
      "color": "#FF6B35",
      "marker": "AL",
      "services": ["fade", "line", "beard"],
      "schedule": {
        "mon": ["10:00-19:00"],
        "tue": ["10:00-19:00"],
        "wed": ["10:00-19:00"],
        "thu": ["10:00-20:00"],
        "fri": ["10:00-20:00"],
        "sat": ["09:00-18:00"]
      },
      "breaks": {
        "mon": ["13:00-13:30"],
        "tue": ["13:00-13:30"],
        "wed": ["13:00-13:30"],
        "thu": ["13:00-13:30"],
        "fri": ["13:00-13:30"],
        "sat": ["13:00-13:30"]
      }
    }
  ],
  
  "legal": {
    "impressum": {
      "legal_name": "Fade Masters GmbH",
      "represented_by": "Owner Name",
      "street": "Kurfürstendamm 42",
      "postal_code": "10711",
      "city": "Berlin",
      "country": "Deutschland",
      "email": "hello@fademasters.de",
      "phone": "+49 30 98765432",
      "dispute_resolution": "not_willing"
    },
    "privacy": {
      "retention_months": 24,
      "hosting": "Supabase (EU, Frankfurt) · Cloudflare Pages",
      "extra_processors": []
    }
  }
}
```

---

## ✨ Особенности и советы

### 1. **Slug** (путь в URL)
- Только буквы, цифры, дефис: `my-shop`, `fade-masters`, `kayan-berlin`
- НЕ используй: `My Shop`, `SHOP_123`, пробелы, спецсимволы
- Будет доступен по: `https://example.com/s/fade-masters/`

### 2. **Локализация**
- `"locale": "de"` → немецкий (интерфейс на немецком)
- `"locale": "en"` → английский
- `"locale": "ru"` → русский

### 3. **Расписание**
- Используй 24-часовой формат: `09:00-19:00`
- Несколько смен: `["09:00-14:00", "15:00-19:00"]`
- Выходной: оставь пустой массив `[]`

### 4. **Цвета**
- HEX формат: `#DAA520`, `#FF6B35`, `#2BB3A3`
- Инструмент: [colorpicker.com](https://www.colorpicker.com/)
- `accent_color` - главный цвет интерфейса
- `background_color` - фон (обычно тёмный)

### 5. **Цена валюты**
```json
"currency": "EUR",  // €  (Европа)
"currency": "USD",  // $  (США)
"currency": "RUB",  // ₽  (Россия)
"currency": "GBP",  // £  (Англия)
```

### 6. **Фото и оптимизация**
```bash
# Оптимизировать JPG (с ImageMagick)
convert big.jpg -quality 85 -resize 1200x600 optimized.jpg

# Или онлайн: https://tinypng.com/
# Или: https://squoosh.app/
```

### 7. **Услуги и цены**
```json
"services": [
  {
    "key": "unique-id",      // УНИКАЛЬНО внутри барбершопа!
    "name": "Название",
    "description": "Описание",
    "duration_min": 30,      // длительность
    "price": 25,             // цена в валюте
    "policy": {              // опционально
      "cancellation_allowed": false  // нельзя отменить
    }
  }
]
```

### 8. **Специализация барбера**
Напиши что-то читаемое:
```json
"specialties": ["Fade Cuts", "Beard Work", "Patterns", "Styling"]
```

---

## 🔍 Проверка перед деплоем

### JSON валидация
```bash
# Проверь синтаксис
cat tenants/my-shop/business.json | jq .
```

### Сборка проверит:
```bash
npm run build
```

Должно быть:
```
✓ shell /s/my-shop/ — успешно!
```

### Если ошибка:
```
✗ [my-shop] services: Invalid input
```

Проверь:
- Все поля обязательны (кроме optional)
- Нет дублей `"key"` внутри услуг
- JSON синтаксис правильный (кавычки, запятые)
- Изображения существуют в `images/`

---

## 🚀 Полный workflow

```bash
# 1. Создай папку
mkdir -p tenants/my-shop/{images,images/barbers}

# 2. Добавь файлы
cp logo.png tenants/my-shop/images/
cp cover.jpg tenants/my-shop/images/
cp barber.jpg tenants/my-shop/images/barbers/

# 3. Создай business.json
nano tenants/my-shop/business.json
# (скопируй шаблон, заполни)

# 4. Проверь JSON
cat tenants/my-shop/business.json | jq .

# 5. Собери
npm run build

# 6. Если OK → деплой
npx wrangler pages deploy dist/ --project-name barbershoptestweb

# 7. Проверь
# https://barbershoptestweb.pages.dev/s/my-shop/
```

---

## 📚 Ссылки и ресурсы

- **Проверка JSON**: https://jsonlint.com/
- **Ответь цвета**: https://colorpicker.com/
- **Оптимизация фото**: https://squoosh.app/
- **Maskable icons**: https://maskable.app/
- **UUID Generator** (если нужен ID): https://www.uuidgenerator.net/

---

## ❓ Часто задаваемые вопросы

### Q: Как изменить домен?
A: Используй slug в URL: `/s/{slug}/`. Домен один (termin.quest), но салоны разные по slug.

### Q: Можно ли переименовать салон?
A: Можно изменить `name` и `short_name`, но `slug` менять не советую (будут ломаться ссылки).

### Q: Как добавить третьего барбера?
A: Добавь ещё объект в массив `"barbers"` с новым уникальным `"key"`.

### Q: Как скрыть салон?
A: Удали папку `tenants/my-shop/`, пересобери `npm run build`, переделой.

### Q: Почему ошибка "invalid tenant"?
A: В `business.json` что-то не так. Проверь:
- JSON синтаксис (кавычки, запятые)
- Все обязательные поля есть
- Изображения существуют

---

**Готов добавлять барбершопы? Начни с KAYAN CUT как примера!** 🚀
