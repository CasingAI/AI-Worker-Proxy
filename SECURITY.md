# 安全策略

## 🎯 核心职责下的安全范围

本项目的核心职责是提供一个 OpenAI Responses API 兼容代理层，
并将请求路由到 OpenAI 与智谱 GLM。安全控制重点覆盖该代理边界：
鉴权、密钥管理、请求转发安全与响应安全。

## 🔒 漏洞上报方式

**重要：发现安全漏洞时，请勿提交公开 Issue。**

请通过私密渠道提交安全问题：
- 地址：https://github.com/zxcloli666/AI-Worker-Proxy/security/advisories/new

我们会在 **48 小时内** 响应。

## ✅ 支持版本

| 版本 | 支持状态 |
| ---- | -------- |
| 1.x.x | ✅ 持续支持 |

## 🛡️ 安全最佳实践

### 面向使用者
- **不要把 API Key 提交到仓库**
- 密钥请存放在 **Cloudflare Dashboard**（Workers → Settings → Variables）
- 使用高强度的 **PROXY_AUTH_TOKEN**（建议 32 位以上随机字符）
- 定期轮换密钥与令牌
- 持续关注 Cloudflare Workers 日志中的异常请求

### 面向贡献者
- 不要在 PR 中暴露密钥
- 本地开发请使用 `.dev.vars`（并确保加入 `.gitignore`）
- 提交前检查潜在安全问题
- 遵循最小权限原则

## 🚨 已知安全注意事项

1. **CORS**：默认对所有来源开放  
   - 生产环境可在 `src/index.ts` 中收紧策略

2. **鉴权**：除 `/health` 外，其他接口都要求鉴权  
   - 请在 Cloudflare Dashboard 中配置 `PROXY_AUTH_TOKEN`

3. **API Key 存储**：  
   - 存储在 Cloudflare Worker Secrets（静态加密）
   - 不应在日志或响应体中暴露

4. **请求转发**：  
   - 代理会将请求转发到 OpenAI 与智谱 GLM API
   - 转发前应确保输入已被验证

## 📚 安全参考

- [Cloudflare Workers Security](https://developers.cloudflare.com/workers/platform/security/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)

## 🔄 更新策略

安全补丁会尽快发布。请及时更新到最新版本：

```bash
git pull origin main
npm run deploy
```

---

**请始终把密钥安全放在第一位。🔒**