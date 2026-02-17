# FIX 记录

## response.output_item.done 在 text 后接 function call 时的缺失

### 现象

当流式响应中先有 `response.output_text.delta`（一段 assistant 文本），随后同一轮又出现 `delta.tool_calls`（function call）时，**前一个 message 项不会收到**：

- `response.output_text.done`
- `response.content_part.done`
- `response.output_item.done`

只会在流结束时对**最后一个** output 项（即 function_call）调用 `closeLastOutputItem`，导致前面的 message 项没有完成事件。

### OpenAI 的预期行为（文档语义）

根据对 OpenAI Responses API 流式文档的检索：

1. **每个 output item 都应有 `response.output_item.done`**：表示该 item 生成完成。
2. **顺序要求**：必须先发出当前 item 的 `output_item.done`，**之后**才能发出下一个 item 的 `output_item.added`。

因此，当「文本 message → function call」时，正确顺序应为：

1. 对当前 message：`response.output_text.done` → `response.content_part.done` → `response.output_item.done`
2. 再发出：`response.output_item.added`（新的 function_call）及后续 function_call 相关事件。

### 参考实现 responses.js-main 的情况

**responses.js-main 也有同样错误**：在 `src/routes/responses.ts` 中，进入 `delta.tool_calls` 分支时没有先对上一个 message 调用 `closeLastOutputItem`，直接 push 新的 function_call 并 yield `response.output_item.added`，因此前一个 message 的 done 事件会缺失。修复时以 OpenAI 文档为准，不要以 responses.js-main 为参考。

### 本仓库修复方式

在 `src/utils/chat-to-responses.ts` 中，进入 `delta.tool_calls` 分支时，若当前最后一个 output 项是 in_progress 的 message，先对该项执行 `closeLastOutputItem`，再 push 新的 function_call 并发送其事件，使行为与 OpenAI 文档一致。
