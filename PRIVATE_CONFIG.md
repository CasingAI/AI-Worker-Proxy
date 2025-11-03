# Приватная конфигурация для продакшена

## ⚠️ ВАЖНО: Публичный репозиторий

Поскольку этот репозиторий публичный, **НЕ добавляйте приватные токены в `wrangler.toml`**!

## 🔒 Как настроить приватный конфиг

### Способ 1: Через Cloudflare Dashboard (РЕКОМЕНДУЕТСЯ)

1. **Откройте Cloudflare Dashboard:**
   - Перейдите в: `Workers & Pages` → `ai-worker-proxy` → `Settings` → `Variables`

2. **Добавьте Environment Variables:**

   **Переменная: `ROUTES_CONFIG`**
   ```json
   {
     "your-model": [
       {
         "provider": "anthropic",
         "model": "claude-opus-4-20250514",
         "apiKeys": ["ANTHROPIC_KEY_1"]
       }
     ],
     "fast": [
       {
         "provider": "google",
         "model": "gemini-2.0-flash-exp",
         "apiKeys": ["GOOGLE_KEY_1"]
       }
     ]
   }
   ```

   **Переменная: `PROXY_AUTH_TOKEN`**
   ```
   your-real-secret-token
   ```

3. **Добавьте Secrets (API ключи):**
   - Нажмите "Add variable" → выберите "Encrypt"
   - Добавьте все ваши API ключи:
     - `ANTHROPIC_KEY_1` = `sk-ant-xxxxx`
     - `GOOGLE_KEY_1` = `AIzaxxxxx`
     - `OPENAI_KEY_1` = `sk-xxxxx`
     - и т.д.

4. **Сохраните и деплойте:**
   - Нажмите "Save and Deploy"
   - Или просто сохраните - GitHub Actions не перезапишет эти переменные благодаря флагу `--keep-vars`

---

### Способ 2: Через Wrangler CLI (локально)

```bash
# Добавить Environment Variables
wrangler secret put ANTHROPIC_KEY_1
wrangler secret put GOOGLE_KEY_1
wrangler secret put PROXY_AUTH_TOKEN

# Установить ROUTES_CONFIG через dashboard или:
# Создать отдельный wrangler.production.toml (НЕ коммитить!)
```

---

### Способ 3: Cloudflare KV Storage (продвинутый)

Если хотите изменять конфиг без редеплоя:

1. **Создайте KV namespace:**
   ```bash
   wrangler kv:namespace create "CONFIG"
   ```

2. **Добавьте в wrangler.toml:**
   ```toml
   [[kv_namespaces]]
   binding = "CONFIG"
   id = "your-kv-id"
   ```

3. **Загрузите конфиг в KV:**
   ```bash
   wrangler kv:key put --namespace-id=xxx "ROUTES_CONFIG" @config.json
   ```

4. **Измените код для чтения из KV:**
   ```typescript
   // src/router.ts
   const configStr = await env.CONFIG.get("ROUTES_CONFIG") || env.ROUTES_CONFIG;
   ```

---

## 🚀 GitHub Actions и приватный конфиг

GitHub Actions **НЕ перезапишет** ваш приватный конфиг благодаря флагу `--keep-vars`:

```yaml
# .github/workflows/deploy.yml
- name: Deploy to Cloudflare Workers
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: deploy --keep-vars  # <-- Сохраняет переменные из дашборда
```

### Что происходит при деплое:

- ✅ **Обновляется:** Код (TypeScript файлы)
- ✅ **Обновляется:** Зависимости (package.json)
- ❌ **НЕ обновляется:** Environment Variables из дашборда
- ❌ **НЕ обновляется:** Secrets

---

## 📋 Чеклист настройки

- [ ] Добавлены все Environment Variables в Cloudflare Dashboard
- [ ] Добавлены все Secrets (API ключи)
- [ ] Проверено что `ROUTES_CONFIG` содержит ваши приватные роуты
- [ ] `wrangler.toml` в репо содержит только пример
- [ ] GitHub Actions имеет флаг `--keep-vars`
- [ ] Протестирован деплой - приватный конфиг не перезаписывается

---

## 🔍 Проверка конфигурации

После деплоя проверьте что используется ваш приватный конфиг:

```bash
# Проверить переменные
wrangler tail

# Или сделайте тестовый запрос
curl https://your-worker.workers.dev/health
```

---

## ⚙️ Локальная разработка

Для локальной разработки создайте `.dev.vars` (не коммитится):

```bash
# .dev.vars
PROXY_AUTH_TOKEN=local-dev-token
ANTHROPIC_KEY_1=sk-ant-xxxxx
GOOGLE_KEY_1=AIzaxxxxx

ROUTES_CONFIG={"test": [{"provider": "anthropic", "model": "claude-opus-4", "apiKeys": ["ANTHROPIC_KEY_1"]}]}
```

Затем:
```bash
npm run dev
```

---

## 🆘 Troubleshooting

### Конфиг перезаписывается при деплое

**Проблема:** GitHub Actions перезаписывает ваш приватный конфиг

**Решение:**
1. Проверьте что в `.github/workflows/deploy.yml` есть `command: deploy --keep-vars`
2. Если нет - добавьте и закоммитьте
3. Пересоздайте Environment Variables в дашборде

### Переменные не читаются

**Проблема:** Worker не видит переменные из дашборда

**Решение:**
1. Убедитесь что переменные добавлены именно в Environment Variables (не в Secrets для vars)
2. Secrets используйте только для API ключей
3. После изменения переменных в дашборде нажмите "Save and Deploy"

---

## 📖 Дополнительно

- [Cloudflare Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Wrangler Secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
- [KV Storage](https://developers.cloudflare.com/kv/)
