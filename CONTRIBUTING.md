# AI Worker Proxy 贡献指南

感谢你愿意为 AI Worker Proxy 做贡献！

## 项目核心职责

本项目当前聚焦维护一个 OpenAI Responses API 兼容网关，
并将请求路由到 OpenAI 与智谱 GLM。提交任何改动时，请优先保证这一核心职责不被削弱。

## 开发环境准备

1. **Fork 并克隆仓库**

```bash
git clone https://github.com/YOUR_USERNAME/AI-Worker-Proxy.git
cd AI-Worker-Proxy
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

```bash
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填入你的 API Key
```

4. **本地启动**

```bash
npm run dev
```

## 代码风格

项目使用 ESLint 与 Prettier 管理代码质量与格式：

```bash
# 检查 lint
npm run lint

# 检查类型
npm run type-check

# 自动格式化
npm run format
```

## Provider 层贡献说明

当前优先级是保证 OpenAI + Zhipu 在同一个 Responses 契约下行为一致。  
如果你想新增 provider，请先评估它是否会破坏兼容契约，再推进实现。

1. 在 `src/providers/` 新建 provider 文件（例如 `my-provider.ts`）
2. 实现 `src/providers/base.ts` 中的 `AIProvider` 接口
3. 在 `src/types.ts` 中补充 provider 类型
4. 在 `src/providers/index.ts` 中注册该 provider
5. 在文档中补充该 provider 与 Responses 契约兼容说明

示例：

```typescript
import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse } from '../types';

export class MyProvider extends BaseProvider {
  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    // 在这里实现你的逻辑
  }
}
```

## 测试要求

提交 PR 前请至少完成以下检查：

1. 运行基础检查

```bash
npm run lint
npm run type-check
```

2. 用 `npm run dev` 进行本地验证
3. 验证 OpenAI 与 Zhipu 两条路由（单路由与 fallback 路由都要覆盖）
4. 验证流式与非流式两种返回
5. 验证错误处理与故障回退场景

## Pull Request 流程

1. 从 `main` 新建功能分支
2. 完成代码修改
3. 确保测试、lint、类型检查通过
4. 如有必要，同步更新文档
5. 发起 PR，并清楚描述改动目的与影响

## Commit 信息建议

建议使用清晰、可读的提交前缀与描述：

- `feat: add support for XYZ provider`
- `fix: handle timeout errors in token rotation`
- `docs: update configuration examples`
- `refactor: simplify error handling`

## 有疑问？

欢迎直接在 GitHub 提交 Issue 讨论。
