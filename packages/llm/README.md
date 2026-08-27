# @whole/llm

[English](./README.md) | [简体中文](./README.zh-Hans.md)

Request construction and response parsing for a user-supplied model endpoint:
provider config validation, endpoint probing, chat-request building for both
wire protocols (OpenAI-compatible chat and Anthropic messages), and a typed
send/receive over an injected fetch.

Pure TypeScript with one dependency (`zod`) — no React Native, no Expo, no
global fetch. The transport is a parameter (`LlmFetch`), so the package runs
identically in the app through Metro, in Node, and under Vitest, and every
failure path stays reachable from a plain unit test.

## Why it is its own package

The recognition pipeline (see
[`@whole/ocr`](../ocr/README.md)) sends a screenshot's text to a model endpoint
the user configures in Settings. That involves three things that must not live
in app code:

- **The wire protocol details.** Two protocols (OpenAI-compatible chat and
  Anthropic messages) are a FIELD on the config, not a provider abstraction —
  adding a third means one more `api` value and one more request builder, not
  another layer.
- **Structured-output negotiation.** An endpoint can be made to return
  parseable JSON in three ways of descending reliability (`json_schema`,
  `tool`, `prompt`), discovered once by probing and then recorded on the
  config. Absent means "not probed yet", which is a different state from
  "probed and found to support only prompting".
- **The no-globals rule.** The package's `tsconfig.json` sets `"types": []`:
  no `URL`, no `fetch`, no `process`. A package that cannot reach a global is a
  package that runs identically under Node, Metro, and Vitest — which is why
  the URL host is parsed with a ten-line regex rather than `URL`.

## Layout

```text
src/provider.ts   The config schema: api, credentials, model, host, and the
                  discovered structured-output mode
src/probe.ts      One-shot endpoint probing: what does it serve, which models,
                  how can it be made to return JSON
src/request.ts    ChatPrompt → ChatRequest: a request described as data, not
                  performed
src/send.ts       sendChat over an injected LlmFetch, with typed failures
                  (LlmError) instead of thrown protocol details
```

## Testing

```bash
pnpm test:llm              # Vitest, in-process, no network
pnpm test:llm:coverage     # 100% lines/branches/functions/statements
```

Coverage is at the hard 100% threshold every config in this repo shares; `v8
ignore` is not permitted (see AGENTS.md).
