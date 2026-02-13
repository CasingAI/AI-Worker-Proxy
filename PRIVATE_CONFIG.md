# 私有配置指南

## 🎯 项目主要职责（配置视角）

- 对外提供 **OpenAI Responses API 兼容入口**
- 对内在 **OpenAI 与 Zhipu GLM** 之间做路由与故障回退
- 通过 **ROUTES_CONFIG + Secrets** 持续维护统一调用契约

## ⚙️ 工作机制

- **`ROUTES_CONFIG`**：存储在 GitHub Variables，部署时注入 `wrangler.toml`
- **Secrets**（`PROXY_AUTH_TOKEN`、各类 API Key）：存储在 Cloudflare Dashboard，手动维护并可长期保留

**关键点：** Cloudflare Secrets 不会被 `wrangler deploy` 删除。配置一次后可长期复用。

---

## 📝 配置步骤

### 第一步：在 Cloudflare Dashboard 添加 Secrets

1. 打开 **Cloudflare Dashboard** → **Workers & Pages** → **ai-worker-proxy** → **Settings** → **Variables**
2. 点击 **Add variable**，并选择 **Encrypt**（即 Secret）
3. 添加以下密钥：
   - `PROXY_AUTH_TOKEN` = `your-secret-token`
   - `OPENAI_KEY_1` = `sk-xxxxx`
   - `OPENAI_KEY_2` = `sk-xxxxx`
   - `ZHIPU_KEY_1` = `zhipu-sk-xxxxx`
   - `ZHIPU_KEY_2` = `zhipu-sk-xxxxx`
   - 其他按需添加
4. 点击 **Save and Deploy**

**重要：** 这些 Secrets 不会被 GitHub Actions 覆盖或删除。

### 第二步：添加 GitHub Variable

1. 打开仓库 → **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. 点击 **New repository variable**
3. 名称填写：`ROUTES_CONFIG`
4. 值填写（支持格式化 JSON）：

```json
{
  "openai-main": [
    {
      "provider": "openai",
      "model": "gpt-4.1",
      "apiKeys": ["OPENAI_KEY_1", "OPENAI_KEY_2"]
    }
  ],
  "glm-main": [
    {
      "provider": "zhipu",
      "model": "glm-4.7",
      "apiKeys": ["ZHIPU_KEY_1", "ZHIPU_KEY_2"]
    }
  ],
  "fallback-mix": [
    {
      "provider": "zhipu",
      "model": "glm-4.7-flash",
      "apiKeys": ["ZHIPU_KEY_1"]
    },
    {
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "apiKeys": ["OPENAI_KEY_1"]
    }
  ]
}
```

### 第三步：添加 GitHub Secrets（用于 Cloudflare 鉴权）

1. 打开 **Secrets** 标签（与 Variables 同级）
2. 添加以下内容：
   - `CLOUDFLARE_API_TOKEN`：Cloudflare API Token
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID

### 第四步：触发部署

```bash
git push origin main
```

GitHub Actions 会自动：
1. 用 GitHub Variable 覆盖 `wrangler.toml` 中的 `ROUTES_CONFIG`
2. 执行 Cloudflare 部署
3. 保留 Cloudflare Dashboard 中已有的 Secrets

---

## 🔄 配置更新方法

### 更新路由（ROUTES_CONFIG）

1. 在 GitHub 修改 `ROUTES_CONFIG` 变量
2. 推送任意 commit 到 `main`（或手动重跑 workflow）
3. 新路由自动生效

### 更新密钥（API Key / Auth Token）

1. 打开 Cloudflare Dashboard → Workers & Pages → ai-worker-proxy → Settings → Variables
2. 编辑对应的加密变量
3. 点击 **Save and Deploy**
4. 无需推送代码

---

## 🏠 本地开发

新建 `.dev.vars`（不要提交到仓库）：

```bash
# .dev.vars
PROXY_AUTH_TOKEN=local-dev-token
OPENAI_KEY_1=sk-xxxxx
ZHIPU_KEY_1=zhipu-sk-xxxxx

ROUTES_CONFIG={"test":[{"provider":"openai","model":"gpt-4.1","apiKeys":["OPENAI_KEY_1"]},{"provider":"zhipu","model":"glm-4.7","apiKeys":["ZHIPU_KEY_1"]}]}
```

本地启动：

```bash
npm run dev
```

Wrangler 会自动读取 `.dev.vars`。

---

## 🆘 故障排查

### GitHub Actions 报错：`vars.ROUTES_CONFIG not found`

**解决方式：**
1. 确认 `ROUTES_CONFIG` 添加在 **Variables**（不是 Secrets）
2. 打开 Settings → Secrets and variables → Actions → **Variables**
3. 注意 Variables 与 Secrets 是不同标签页

### Worker 鉴权失败 / 缺少 API Key

**解决方式：**
1. 确认密钥配置在 **Cloudflare Dashboard**（不是 GitHub）
2. 路径：Workers & Pages → ai-worker-proxy → Settings → Variables
3. 确认变量为加密状态（Encrypted）
4. 编辑后点击 **Save and Deploy**

### Push 后 ROUTES_CONFIG 没有更新

**解决方式：**
1. 查看 GitHub Actions 日志，确认 workflow 是否执行
2. 检查 GitHub Variable `ROUTES_CONFIG` 是否正确
3. 确认 JSON 合法（可用 JSON 校验工具）
4. 在日志里确认 workflow 是否替换了 `[vars]` 段

### 想新增路由能力

**说明：**
当前项目默认聚焦 OpenAI 与 Zhipu GLM。  
若要新增其他供应商，需要先修改代码中的 provider 类型与适配层，再更新配置。

---

## 📋 自检清单

- [ ] 已在 Cloudflare Dashboard 添加全部 Secrets（加密变量）
- [ ] 已在 GitHub Variables 配置 `ROUTES_CONFIG`
- [ ] 已在 GitHub Secrets 配置 `CLOUDFLARE_API_TOKEN`
- [ ] 已在 GitHub Secrets 配置 `CLOUDFLARE_ACCOUNT_ID`
- [ ] 已创建本地 `.dev.vars`（且未提交）
- [ ] 已推送到 `main` 并验证部署成功

---

## 📖 为什么这样设计

**问题：**
- Wrangler 会覆盖 `wrangler.toml [vars]` 中定义的变量
- 但 Cloudflare Secrets 不会被 `wrangler deploy` 删除

**方案：**
- 把 `ROUTES_CONFIG` 放在 `[vars]`，由 GitHub Actions 在部署前动态替换
- 把敏感信息（token、API Key）放在 Cloudflare Secrets

**结果：**
- 公共仓库保持干净（仅保留示例配置）
- ROUTES_CONFIG 可以快速在 GitHub 侧更新
- Secrets 留在 Cloudflare，安全性更高
- 降低误覆盖风险

---

## 📚 参考资料

- [Cloudflare Secrets Documentation](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub Actions Variables](https://docs.github.com/en/actions/learn-github-actions/variables)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
