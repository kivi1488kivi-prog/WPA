# 🚀 Быстрый деплой на Cloudflare Pages
# Использование: .\deploy.ps1

Write-Host "┌─────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│  🚀 Cloudflare Pages Deployer для Barbershop PWA       │" -ForegroundColor Cyan
Write-Host "└─────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

# ===== ШАГИ ДЕПЛОЯ =====

Write-Host "📌 Шаг 1: Логин в Wrangler..." -ForegroundColor Yellow
$loginCheck = npx wrangler whoami 2>&1
if ($loginCheck -match "error" -or $loginCheck -match "not authenticated") {
    Write-Host "⚠️  Не залогинен в Wrangler. Логинимся..."
    npx wrangler login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Ошибка логина!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✅ Уже залогинен" -ForegroundColor Green
}

Write-Host ""
Write-Host "📌 Шаг 2: Сборка проекта..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка сборки!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Сборка завершена" -ForegroundColor Green

Write-Host ""
Write-Host "📌 Шаг 3: Проверка dist папки..." -ForegroundColor Yellow
if (-not (Test-Path dist/index.html)) {
    Write-Host "❌ dist/index.html не найден!" -ForegroundColor Red
    exit 1
}
Write-Host "✅ dist папка готова" -ForegroundColor Green

Write-Host ""
Write-Host "📌 Шаг 4: Деплой на Cloudflare Pages..." -ForegroundColor Yellow
Write-Host "Проект: barbershoptestweb" -ForegroundColor Cyan

npx wrangler pages publish dist/ --project-name barbershoptestweb

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "┌─────────────────────────────────────────────────────────┐" -ForegroundColor Green
    Write-Host "│  ✅ ДЕПЛОЙ УСПЕШНО ЗАВЕРШЁН!                            │" -ForegroundColor Green
    Write-Host "└─────────────────────────────────────────────────────────┘" -ForegroundColor Green
    Write-Host ""
    Write-Host "📍 Статус деплоя:" -ForegroundColor Yellow
    Write-Host "   Страница: https://barbershoptestweb.[ID].pages.dev" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "🔗 Следующие шаги:" -ForegroundColor Yellow
    Write-Host "   1. Открой URL выше в браузере" -ForegroundColor White
    Write-Host "   2. Проверь что приложение загружается" -ForegroundColor White
    Write-Host "   3. Привяжи домен termin.quest (смотри CLOUDFLARE_DEPLOY.md)" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "❌ Ошибка деплоя!" -ForegroundColor Red
    exit 1
}
