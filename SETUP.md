# 快速部署指南

## 核心职责

本项目的主要职责是对外提供一个 OpenAI Responses API 兼容入口，
并在内部将请求路由到 OpenAI 与智谱 GLM，统一鉴权、Key 轮换与故障回退策略。

## 前置条件

- 已安装 Node.js 20+
- 拥有 Cloudflare 账号
- 准备好要使用的 API Key（OpenAI / Zhipu）

## 分步配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置模型别名

编辑 `wrangler.toml`，按需修改 `ROUTES_CONFIG`：

```toml
ROUTES_CONFIG = '''
{
  "your-model-name": [
    {
      "provider": "openai",
      "model": "gpt-4.1",
      "apiKeys": ["OPENAI_KEY_1"]
    },
    {
      "provider": "zhipu",
      "model": "glm-4.7",
      "apiKeys": ["ZHIPU_KEY_1"]
    }
  ]
}
'''
```

**注意**：在 API 请求里请使用模型别名（如 `"fast"`、`"deep-think"`），不要使用 URL 路径做路由。

### 3. 配置 API Key

本地开发先创建 `.dev.vars` 文件：

```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填入你的密钥：

```
PROXY_AUTH_TOKEN=my-secret-token
OPENAI_KEY_1=sk-xxxxx
ZHIPU_KEY_1=zhipu-sk-xxxxx
```

生产环境建议使用 Wrangler Secrets：

```bash
wrangler secret put PROXY_AUTH_TOKEN
wrangler secret put OPENAI_KEY_1
wrangler secret put ZHIPU_KEY_1
# ... 按需继续添加
```

**可选 — Relay 白名单**：若使用 `/relay?url=...` 代理转发能力，需在 `wrangler.toml` 的 `[vars]` 或 `.dev.vars` 中配置 `RELAY_ALLOWED_HOSTS`（JSON 数组字符串，如 `["api.openai.com","api.example.com"]`）。未配置或空数组时 relay 请求会返回 403。

### 4. 本地验证

```bash
npm run dev
```

可用以下命令测试接口：

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-token" \
  -d '{
    "model": "your-model-name",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 5. 部署到 Cloudflare

```bash
npm run deploy
```

### 6. （可选）配置 GitHub Actions 自动部署

如果你想在 push 到 `main` 时自动部署：

1. 打开 Cloudflare 控制台
2. 创建 API Token：https://dash.cloudflare.com/profile/api-tokens
3. 在控制台获取 Account ID
4. 把下列值添加为 GitHub Secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

之后每次推送到 `main` 都会自动部署。

## 常见问题

### 出现 "Unauthorized" 错误

- 检查 `Authorization` 请求头是否与 `PROXY_AUTH_TOKEN` 一致
- 正确格式：`Authorization: Bearer your-token-here`

### 出现 "All providers failed" 错误

- 确认 API Key 配置正确
- 确认 `ROUTES_CONFIG` 中 provider 与 model 名称正确
- 在 Cloudflare Workers 日志里查看具体错误

### TypeScript 类型检查失败

```bash
npm run type-check
```

### Lint 检查失败

```bash
npm run lint
npm run format
```

## 下一步建议

- 阅读完整文档 [README.md](README.md)
- 查看客户端示例目录 [examples/](examples/)
- 按需定制 `src/utils/error-handler.ts` 的错误处理
- 持续完善 `src/providers/openai.ts` 与 `src/providers/zhipu.ts` 的 Responses 兼容细节

## 支持

如果需要帮助，请在 GitHub 提交 Issue。
