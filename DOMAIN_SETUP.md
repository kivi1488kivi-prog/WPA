# 🌐 Подробный гайд: Подключение домена termin.quest к Cloudflare

## 📍 Текущая ситуация

- **Домен:** termin.quest (куплен)
- **Сервис хостинга:** Cloudflare Pages (barbershoptestweb)
- **DNS провайдер:** ???  (зависит где купил домен)

---

## 🎯 Шаг 1: Определи где куплен домен

Где ты купил domен termin.quest? Выбери вариант:

### Вариант A: Домен куплен у Cloudflare
Переходи к [Вариант A ниже](#вариант-a-домен-куплен-в-cloudflare-самый-быстрый)

### Вариант B: Домен куплен на другом сайте (Namecheap, GoDaddy, регистратор.ру и т.д.)
Переходи к [Вариант B ниже](#вариант-b-домен-куплен-в-другом-месте)

### Вариант C: Не знаю / не помню
Проверь почту → найди письмо с подтверждением покупки домена → там будет указано где купил

---

## ✅ Вариант A: Домен куплен в Cloudflare (самый быстрый)

### Шаг 1: Просто подключи к Pages проекту

1. Зайди в https://dash.cloudflare.com
2. Слева в меню → **Websites** (или **Zones**)
3. Ты должен увидеть **termin.quest** в списке

**Если видишь termin.quest:**
   - Кликни на него
   - Должен открыться dashboard для домена

**Если НЕ видишь:**
   - Нажми **Add site**
   - Введи: `termin.quest`
   - Выбери Free план (нормально)
   - Cloudflare скажет: "Already registered with Cloudflare" или "Domain is already your nameserver"

### Шаг 2: Привяжи Pages project к домену

1. Зайди в **Pages** → **barbershoptestweb**
2. Нажми **Settings**
3. Слева → **Custom domains**
4. Нажми **Add custom domain** или **Set up custom domain**
5. Введи: `termin.quest`
6. Нажми **Continue**
7. Cloudflare скажет: "Activating..."

✅ **Готово!** Через 5-10 минут твой домен будет готов.

#### Если нужна www версия:

Повтори шаги выше для `www.termin.quest`:
- На шаге 5 введи: `www.termin.quest`
- Cloudflare автоматически создаст CNAME

---

## ✅ Вариант B: Домен куплен в другом месте

### Шаг 1: Добавь домен в Cloudflare

1. Зайди в https://dash.cloudflare.com
2. **Add site** (справа вверху)
3. Введи: `termin.quest`
4. Нажми **Continue**
5. Выбери план: **Free** (нормально для старта)

### Шаг 2: Cloudflare даст тебе Nameserver

Ты увидишь экран с двумя nameserver:

```
victoria.ns.cloudflare.com
wyatt.ns.cloudflare.com
```

**ВАЖНО:** Оставь эту вкладку открытой! Она ещё пригодится.

### Шаг 3: Измени Nameserver в регистраторе (где купил домен)

Где ты купил домен? Выбери регистратор:

#### 🔹 Namecheap

1. Зайди в https://www.namecheap.com → Dashboard
2. Найди домен **termin.quest** в списке
3. Кликни **Manage**
4. Слева → **Nameservers**
5. Выбери **Custom DNS**
6. Удали все текущие nameserver
7. Добавь Cloudflare nameserver:
   - `victoria.ns.cloudflare.com`
   - `wyatt.ns.cloudflare.com`
8. **Save**

#### 🔹 GoDaddy

1. Зайди в https://myaccount.godaddy.com
2. Найди **termin.quest** в списке доменов
3. Кликни **Manage**
4. **DNS** или **Nameservers**
5. Выбери **Change Nameservers** → **I'll use other nameservers**
6. Удали текущие, добавь:
   - `victoria.ns.cloudflare.com`
   - `wyatt.ns.cloudflare.com`
7. **Save**

#### 🔹 регистратор.ру

1. Зайди в личный кабинет
2. Мои домены → **termin.quest**
3. **Управление** → **DNS / Nameservers**
4. Выбери Cloudflare nameserver из списка ИЛИ введи вручную:
   - `victoria.ns.cloudflare.com`
   - `wyatt.ns.cloudflare.com`
5. **Сохранить**

#### 🔹 Другой регистратор (Microsoft, DreamHost, OpenRegistry и т.д.)

Обычно путь такой:
1. Логин в кабинет регистратора
2. Мои домены / Управление доменами
3. Выбери **termin.quest**
4. DNS Settings / Nameservers
5. Замени на Cloudflare nameserver:
   - `victoria.ns.cloudflare.com`
   - `wyatt.ns.cloudflare.com`
6. Сохрани

**Если не найдёшь:** погугли "[название регистратора] change nameserver" или позвони в support регистратора.

### Шаг 4: Жди распространения (может быть 24-48 часов)

После изменения nameserver нужно подождать пока DNS распространится. Это занимает:
- Обычно: 15 минут - 2 часа
- Редко: 24-48 часов (если регистратор медленный)

**Проверь статус:**
```bash
nslookup termin.quest
```

Если видишь Cloudflare nameserver → DNS распространился ✅

### Шаг 5: Вернись в Cloudflare и активируй

1. Зайди в https://dash.cloudflare.com → **Websites**
2. Кликни на **termin.quest**
3. Cloudflare проверит NS и скажет:
   - ✅ "Name servers changed successfully"
   - Или в углу будет **Activate account** кнопка

Если нужно - нажми **Activate** или **Continue**

### Шаг 6: Привяжи Pages project к домену

1. Зайди в **Pages** → **barbershoptestweb**
2. **Settings** → **Custom domains**
3. **Add custom domain**
4. Введи: `termin.quest`
5. Кликни **Continue**

Cloudflare создаст CNAME запись автоматически.

✅ **Готово!** Через 5-10 минут всё будет работать.

---

## 🔍 Как проверить что всё правильно подключено?

### Проверка 1: Nameserver

```bash
nslookup -type=NS termin.quest
```

**Должен показать:**
```
Non-authoritative answer:
termin.quest   nameserver = victoria.ns.cloudflare.com
termin.quest   nameserver = wyatt.ns.cloudflare.com
```

### Проверка 2: CNAME запись

```bash
nslookup termin.quest
```

**Должен показать IP адрес (cloudflare сервер)** типо:
```
Non-authoritative answer:
Name:   termin.quest
Address: 104.21.35.112  (или другой Cloudflare IP)
```

### Проверка 3: В браузере

1. Открой в браузере: `https://termin.quest`
2. Должно загрузиться твое PWA приложение
3. Должен быть HTTPS (замочек в адресной строке)

---

## ⚙️ Настройка SSL/TLS

Cloudflare автоматически добавляет HTTPS, но проверь что включено:

1. Зайди в **Websites** → **termin.quest**
2. Слева **SSL/TLS**
3. Выбери **Flexible** или **Full**
   - **Flexible** = Cloudflare → твой сервер (обычно HTTP)
   - **Full** = шифрование везде (лучше)

Для Pages выбери **Full** или **Full (strict)**.

---

## 🚀 Что дальше?

После успешного подключения домена:

### 1. Включи дополнительные функции Cloudflare

В dashboard домена termin.quest:

- ✅ **Caching** → включи кеширование
- ✅ **Minify** → включи минификацию JS/CSS
- ✅ **Brotli** → включи сжатие Brotli
- ✅ **Always Use HTTPS** → включи редирект с HTTP на HTTPS

### 2. Настрой Email Routing (опционально)

Если хочешь использовать email с домена (info@termin.quest):

1. **Email** → **Email Routing**
2. **Create address** → example: `info@termin.quest`
3. Перенаправлять на свой email

### 3. Настрой Analytics

Смотри статистику трафика:

1. Зайди в **Analytics & Logs**
2. Видишь:
   - Requests count
   - Cache ratio
   - Top pages
   - и т.д.

### 4. Включи DDoS защиту

Cloudflare включает защиту по умолчанию, но проверь:

1. **Security** → **DDoS Protection**
2. Выбери уровень защиты (Cloudflare знает лучше)
3. **Bot Management** (платно) - опционально

---

## 🐛 Если что-то не работает

### Проблема: Домен не открывается (ERR_NAME_NOT_RESOLVED)

**Решение:**
1. Проверь что NS изменены в регистраторе (может быть кешировано)
2. Жди 24 часа (редко требуется)
3. Очисти кеш браузера: Ctrl+Shift+Delete
4. Попробуй в incognito режиме

### Проблема: Открывается но показывает чужой сайт

**Решение:**
1. Проверь что CNAME правильный в Cloudflare
2. Pages project может быть неправильно подключен
3. Пересоздай custom domain

### Проблема: HTTPS не работает (unsafe connection)

**Решение:**
1. Зайди в **SSL/TLS** → выбери **Full** или **Full (strict)**
2. Жди 10-15 минут на распространение сертификата
3. Если не помогло → создай заново CNAME запись

### Проблема: Subdomains (www, api, и т.д.) не работают

Для `www.termin.quest`:

1. **Pages Settings** → **Custom domains**
2. Добавь **www.termin.quest** отдельно (повтори все шаги)

Для других subdomains (api.termin.quest, blog.termin.quest и т.д.):
1. Зайди в **DNS** для домена termin.quest
2. Добавь новый CNAME запись вручную:
   - Имя: `api` (или другой subdomain)
   - Value: `barbershoptestweb.[ID].pages.dev`

---

## 📚 Полезные команды для диагностики

```bash
# Проверить NS
nslookup -type=NS termin.quest

# Проверить A запись
nslookup termin.quest

# Проверить CNAME запись
nslookup -type=CNAME www.termin.quest

# Проверить TTL
nslookup -debug termin.quest

# Проверить HTTP headers и редирект
curl -I https://termin.quest
```

---

## 🎉 Готово!

Если всё прошло успешно:
- ✅ Домен termin.quest работает
- ✅ HTTPS включен
- ✅ PWA доступно на https://termin.quest
- ✅ Мобильное приложение можно установить

**Поздравляю! Твой barbershop booking PWA теперь полностью live!** 🚀
