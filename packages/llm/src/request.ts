import type { ProviderConfig, StructuredOutputMode } from "./provider";

// One model turn: the two prompt halves, the output contract, and the ceiling.
//
// `schema` is a JSON Schema object rather than a zod schema, because that is
// what goes on the wire. The caller converts — zod 4 has `z.toJSONSchema()`
// built in, which is why this package does not need an SDK to do it.
export type ChatPrompt = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Names the output contract; both protocols surface it as a tool name. */
  schemaName: string;
  schema: unknown;
};

// A request described as data, not performed. Nothing here touches a global —
// the caller hands the result to whichever `fetch` it has, which is what keeps
// every branch below reachable from a plain unit test.
export type ChatRequest = {
  url: string;
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  };
};

// A base URL is copied out of a dashboard, so it arrives with and without a
// trailing slash; joining without this produces a double slash that some
// gateways route differently and others 404.
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

// An unprobed endpoint is asked for the strongest tier, because finding out
// whether it can honour that is exactly what the probe is for. Recording the
// answer afterwards is what stops this being re-discovered on every request.
function effectiveMode(config: ProviderConfig): StructuredOutputMode {
  return config.structuredOutput ?? "json_schema";
}

function buildOpenAiChatRequest(
  config: ProviderConfig,
  prompt: ChatPrompt,
): ChatRequest {
  const mode = effectiveMode(config);

  const body: Record<string, unknown> = {
    model: prompt.model,
    max_tokens: prompt.maxTokens,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  };

  if (mode === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: prompt.schemaName,
        strict: true,
        schema: prompt.schema,
      },
    };
  } else if (mode === "tool") {
    body.tools = [
      {
        type: "function",
        function: {
          name: prompt.schemaName,
          parameters: prompt.schema,
        },
      },
    ];
    body.tool_choice = {
      type: "function",
      function: { name: prompt.schemaName },
    };
  }

  return {
    url: joinUrl(config.baseUrl, "chat/completions"),
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Omitted rather than sent empty: a local endpoint usually wants no key
        // at all, and `Bearer undefined` is worse than nothing — some servers
        // reject it outright.
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

function buildAnthropicMessagesRequest(
  config: ProviderConfig,
  prompt: ChatPrompt,
): ChatRequest {
  const mode = effectiveMode(config);

  const body: Record<string, unknown> = {
    model: prompt.model,
    max_tokens: prompt.maxTokens,
    // Anthropic takes the system turn as a top-level field rather than as a
    // message, which is the one structural difference between the protocols
    // that a shared body shape could not paper over.
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  };

  // There is no `response_format` on this protocol, so the schema tier and the
  // tool tier land on the same wire shape. Collapsing them here rather than at
  // the call site keeps the tier a property of the ENDPOINT, not of the caller.
  if (mode !== "prompt") {
    body.tools = [{ name: prompt.schemaName, input_schema: prompt.schema }];
    body.tool_choice = { type: "tool", name: prompt.schemaName };
  }

  return {
    url: joinUrl(config.baseUrl, "v1/messages"),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * Turns a provider config and a prompt into the request to send.
 *
 * The `api` field is the whole dispatch: two protocols cost two builders, and a
 * third would cost one more — not another provider abstraction.
 */
export function buildChatRequest(
  config: ProviderConfig,
  prompt: ChatPrompt,
): ChatRequest {
  return config.api === "openai-chat"
    ? buildOpenAiChatRequest(config, prompt)
    : buildAnthropicMessagesRequest(config, prompt);
}
