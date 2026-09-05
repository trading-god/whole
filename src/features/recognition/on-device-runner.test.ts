import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { ANNOTATION_INFERENCE } from "@whole/ocr";
import { runOnDeviceModel } from "@/features/recognition/on-device-runner";

// model-context is the single seam here: the runner is the thin adapter that
// turns an attempt into completion params, so the call that owns the real
// context (and its error mapping) is mocked wholesale — its own suite drives
// both against a mocked llama.rn.
const mockCompleteOnDevice = jest.fn((_params: Record<string, unknown>) =>
  Promise.resolve({ content: '{"accounts":[]}' } as Record<string, unknown>),
);

jest.mock("@/features/on-device-model/model-context", () => ({
  completeOnDevice: (params: Record<string, unknown>) =>
    mockCompleteOnDevice(params),
}));

const attempt = {
  system: "system turn",
  user: "user turn",
  grammar: 'root ::= "x"',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("runOnDeviceModel", () => {
  it("runs the attempt as a grammar-constrained completion and returns its content", async () => {
    await expect(runOnDeviceModel(attempt)).resolves.toBe('{"accounts":[]}');

    expect(mockCompleteOnDevice).toHaveBeenCalledWith({
      messages: [
        { role: "system", content: "system turn" },
        { role: "user", content: "user turn" },
      ],
      n_predict: ANNOTATION_INFERENCE.maxOutputTokens,
      temperature: ANNOTATION_INFERENCE.temperature,
      grammar: attempt.grammar,
      // llama.rn defaults this on, and the reasoning channel Gemma 4's
      // template then opens is one the grammar cannot fill.
      enable_thinking: false,
    });
  });
});
