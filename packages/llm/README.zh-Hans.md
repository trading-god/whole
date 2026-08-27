# @whole/llm

[English](./README.md) | [简体中文](./README.zh-Hans.md)

面向用户自备模型端点的请求构造与响应解析：供应商配置校验、端点探测、两种线上协议
（OpenAI 兼容 chat 与 Anthropic messages）的会话请求构造，以及通过注入的 fetch
完成的类型化收发。

纯 TypeScript，唯一依赖是 `zod`——没有 React Native，没有 Expo，没有全局
fetch。传输层是一个参数（`LlmFetch`），因此这个包在应用里经 Metro 运行、在 Node
里运行、在 Vitest 下运行都完全一致，每一条失败路径都能在普通单元测试里到达。

## 为什么它是独立的包

识别管线（见 [`@whole/ocr`](../ocr/README.zh-Hans.md)）会把截图文本发给用户在
设置里配置的模型端点。这涉及三件不该写进应用代码的事：

- **线上协议细节。** 两种协议（OpenAI 兼容 chat 与 Anthropic messages）是配置上
  的一个字段，而不是一套供应商抽象——将来加第三种协议只需要多一个 `api` 值和
  一个请求构造器，不需要再多一层。
- **结构化输出协商。** 让端点返回可解析 JSON 有三种方式，可靠性依次递减
  （`json_schema`、`tool`、`prompt`），由探测发现一次后记在配置上。缺省表示
  “尚未探测”，与“探测过、只支持提示词方式”是两种不同的状态。
- **无全局规则。** 包的 `tsconfig.json` 设了 `"types": []`：没有 `URL`，没有
  `fetch`，没有 `process`。一个够不着全局的包，在 Node、Metro、Vitest 下的行为
  必然一致——这也是 URL 的 host 用十行正则而不是 `URL` 解析的原因。

## 目录结构

```text
src/provider.ts   配置 schema：协议、凭证、模型、host，以及探测到的
                  结构化输出方式
src/probe.ts      一次性端点探测：服务什么、有哪些模型、怎样才能返回 JSON
src/request.ts    ChatPrompt → ChatRequest：把请求描述成数据，而不是执行它
src/send.ts       基于注入的 LlmFetch 的 sendChat，用类型化失败（LlmError）
                  取而代之抛出的协议细节
```

## 测试

```bash
pnpm test:llm              # Vitest，进程内，无网络
pnpm test:llm:coverage     # 行/分支/函数/语句 100%
```

覆盖率是本仓库所有配置共享的 100% 硬门槛；不允许 `v8 ignore`（见
AGENTS.md）。
