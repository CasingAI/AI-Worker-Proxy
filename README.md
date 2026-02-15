# 🚀 AI Worker Proxy：OpenAI + GLM 统一为 Responses API

[![部署到 Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![兼容 OpenAI](https://img.shields.io/badge/OpenAI-Compatible-green)](https://openai.com/)
[![MIT 许可](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**还在用 OpenAI 接口发请求，却想在 OpenAI 和 GLM 间灵活切换？**  
这个项目提供一个部署在 Cloudflare Workers 上的免费 AI 网关：你只需把标准的 OpenAI 请求送过来，网关会按配置把流量路由到 OpenAI 或智谱 GLM，并自动轮换 API Key，保持服务不断线。

---

## 🎯 项目主要职责

- **统一协议**：对外只暴露 OpenAI Responses API 兼容接口。  
- **统一路由**：对内把请求路由到 OpenAI 或智谱 GLM。  
- **统一高可用策略**：内置 API Key 轮换与多供应商故障回退（fallback）。  
- **统一调用体验**：让上层应用不感知底层厂商差异。  

---

## 🔥 这套代理有什么好处

- **多模型自动切换**：OpenAI 出问题时自动切到其它厂商，保持服务可用。  
- **多 Key 轮换策略**：配置几组 API Key，接口逐个尝试，消除单点限流。  
- **统一 API 体验**：同一套代码即可访问 OpenAI 与智谱 GLM。  
- **通过 GitHub Variables 静默更新路由**：无需改源码，随时动态调整路由策略。

---

## 🎮 四步部署指南

### 第一步：Fork 仓库
点击页面右上角的 **“Fork”**，复制一份仓库到你的 GitHub 账号。

### 第二步：配置 Cloudflare Secrets
1. 进入你 Fork 后的仓库，打开 `Settings` → `Secrets and variables` → `Actions`。  
2. 点击 `New repository secret`。  
3. 添加以下两个 secret：

- `CLOUDFLARE_ACCOUNT_ID`：可在 Cloudflare 控制台地址栏 `dash.cloudflare.com/...` 中复制账号 ID。  
- `CLOUDFLARE_API_TOKEN`：访问 [API Tokens](https://dash.cloudflare.com/profile/api-tokens)，选择 “Edit Cloudflare Workers” 模板生成 Token。

### 第三步：触发部署
1. 进入仓库的 `Actions` 选项卡，启用 workflow（如果提示）。  
2. 选择 `Deploy to Cloudflare`，点击 `Run workflow`。  
部署大约 1~2 分钟，成功后地址类似 `https://ai-proxy.YOUR-USERNAME.workers.dev`。

### 第四步：在 Cloudflare 填入 AI Key
1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)。  
2. 左侧点击 “Workers & Pages”，选择 `ai-worker-proxy`。  
3. 前往 `Settings` → `Variables and Secrets`，在 Environment Variables 中点击 `Add`，新增：

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `PROXY_AUTH_TOKEN` | `my-secret-password-123` | 访问密码，作为代理的 API Key |
| `OPENAI_KEY_1` | `sk-proj-...` | OpenAI API Key |
| `ZHIPU_KEY_1` | `zhipu-sk-xxx...` | 智谱（质谱）AI Key |

保存后点击 “Save and Deploy” 即可完成部署。

---

## 🤫 通过 GitHub Variables 静默调整路由

无需改源码或 `wrangler.toml`，通过 GitHub 变量控制路由策略：  
1. 打开仓库 → `Settings` → `Secrets and variables` → `Actions`。  
2. 切换到 `Variables` 标签页。  
3. 新建变量 `ROUTES_CONFIG`，内容填入 JSON 配置。

示例配置：

```json
{
  "super-brain": {
    "displayName": "Super Brain",
    "description": "OpenAI + 智谱多厂商弹性路由，优先走 GPT-4.1，失败后 fallback 到智谱 GLM-4.7。",
    "contextWindow": 8192,
    "maxOutputTokens": 2048,
    "flags": ["general"],
    "providers": [
      {
        "provider": "openai",
        "model": "gpt-4.1",
        "apiKeys": ["OPENAI_KEY_1"]
      },
      {
        "provider": "zhipu",
        "model": "glm-4.7",
        "apiKeys": ["ZHIPU_KEY_1"],
        "endpoint": "https://api.z.ai/api/paas/v4/"
      }
    ]
  },
  "zhipu-boost": {
    "displayName": "GLM-4.7 Boost",
    "description": "仅走智谱 GLM-4.7，支持多个 endpoint 轮转。",
    "contextWindow": 65536,
    "providers": [
      {
        "provider": "zhipu",
        "model": "glm-4.7",
        "apiKeys": ["ZHIPU_KEY_1"],
        "endpoint": "https://your-custom-endpoint.example.com/api/paas/v4/"
      },
      {
        "provider": "zhipu",
        "model": "glm-4.7",
        "apiKeys": ["ZHIPU_KEY_2"],
        "endpoint": "https://backup-endpoint.example.com/api/paas/v4/"
      }
    ]
  }
}
```

### 🧠 模型元数据（可选）

每个 route entry 都可以携带一些能力元数据，这些字段会直接出现在 `GET /models` 与 `/v1/models` 的返回值里（旧格式中在 provider 层级定义的字段仍然兼容，只是优先使用 route entry 的值）：

- `description`：可读说明，`/models` 返回的对象会带上这段文字。
- `contextWindow` / `maxInputTokens` / `maxOutputTokens`：描述上下文与输出限制，代理会把它们映射为 OpenAI 兼容字段 `context_length`、`max_input_tokens`、`max_output_tokens`。
- `pricingCurrency`、`inputPricePer1m`、`inputCachePricePer1m`、`outputPricePer1m`：定义计费，代理会把这些值归集到响应的 `pricing` 结构里。
- `metadata`：任意键值对会原样出现在 `/models` 的 `metadata` 字段中，适合传额外标签或特性。
- `flags`：字符串数组，直接出现在 `/models` 返回的数据里，用来列举此路由的能力标签（例如 `glm-4.6v-flash` 配置了 `["image"]`，表示具备图像理解能力）。

每个 route entry 也可以提供 `displayName`，这样 `/models` 中展示的是更友好的名称而不是 ID。

例如：  
```json
{
  "zhipu-flash-latest": {
    "displayName": "GLM-4.7 FlashX",
    "description": "GLM-4.7-Flash（FlashX 计费），原生支持 Cache 套餐",
    "contextWindow": 200000,
    "maxOutputTokens": 16384,
    "providers": [
      {
        "provider": "zhipu",
        "model": "glm-4.7-flash",
        "apiKeys": ["ZHIPU_KEY_1"],
        "endpoint": "https://api.z.ai/api/paas/v4/",
        "pricingCurrency": "cny",
        "inputPricePer1m": 0.5,
        "inputCachePricePer1m": 0.1,
        "outputPricePer1m": 3
      }
    ],
    "metadata": {
      "flash_version": "FlashX",
      "tier": "flash"
    },
    "flags": ["flash"]
  }
}
```
> 上述 `inputPricePer1m` / `outputPricePer1m` / `inputCachePricePer1m` 采用“每百万 tokens（CNY）”的定价单位；其中 `inputCachePricePer1m` 用于标记智谱的 Cache 套餐价格（FlashX 时段常见 0.1 元），与官方价格表一致。

设置好这些字段后，`GET /models` 会额外返回 `context_length`、`max_input_tokens`、`pricing` 等字段，帮助你像调 OpenAI 一样查看代理下的模型能力。

变量保存后再次运行 `Deploy to Cloudflare`，新配置会自动生效。

---

## 🚀 如何调用代理

只需把原来访问 OpenAI 的 base_url 指向你的 Worker，API Key 用 `PROXY_AUTH_TOKEN`。

### Python 示例
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://ai-proxy.YOUR-USERNAME.workers.dev/v1",
    api_key="my-secret-password-123"
)

response = client.responses.create(
    model="super-brain",
    instructions="你是一个乐于助人的助手。",
    input="请介绍一下 GPT-4o。"
)
print(response.output_text)
```

### 其它客户端（如 Chatbox、NextChat、typingmind）
- **基础地址：** `https://ai-proxy.YOUR-USERNAME.workers.dev/v1`  
- **API Key：** 你在 Cloudflare 配置的 `PROXY_AUTH_TOKEN`

---

## 🔒 安全建议

**请不要把真正的 API Key 写进源码！** 所有敏感信息都应存在 Cloudflare Secrets 中，以防被泄露。

---

## 💬 支持与反馈

发现问题或想提建议？欢迎在 [GitHub Issues](https://github.com/zxcloli666/AI-Worker-Proxy/issues) 提交。  
如果这个项目帮你省钱/省力，别忘了点个 Star 支持一下！

---

*标签提示：`openai proxy`、`ai gateway`、`api proxy`、`cloudflare workers ai`、`glm proxy`、`zhipu proxy`、`multi provider ai`、`ai load balancer`、`ai failover`、`free ai proxy`、`ai token rotation`、`gpt-4 proxy free`、`smm ai tools`、`bypass ai rate limit`*
