import { describe, expect, it } from "vitest";

import type { ModelRecognitionResult } from "@/features/recognition/model-recognition";
import { issueForRecognition } from "@/features/recognition/recognition-issue";

const recognized = (count: number): ModelRecognitionResult => ({
  status: "recognized",
  recognition: {
    accounts: Array.from({ length: count }, (_unused, index) => ({
      accountName: `Account ${index}`,
    })),
  },
  fingerprint: { hash: "abc", tokens: ["account"] },
  usage: { inputTokens: 1, outputTokens: 2 },
});

describe("issueForRecognition", () => {
  // Nothing to report: the screen read accounts, and what the form does with
  // them is the form's business.
  it("reports nothing when accounts were recognized", () => {
    expect(issueForRecognition(recognized(2))).toBeNull();
  });

  // The pipeline succeeded and the screen held nothing. That is a different
  // message from every failure below, because retrying will not change it.
  it("reports an empty screen when the model found no accounts", () => {
    expect(issueForRecognition(recognized(0))).toBe("recognitionEmpty");
  });

  // Every one of these has a different next step, which is the whole reason
  // they are not collapsed into one "recognition failed".
  it.each([
    [{ status: "not-configured" } as const, "modelNotConfigured"],
    [
      {
        status: "consent-required",
        host: "api.example.com",
        isLocal: false,
      } as const,
      "modelConsentRequired",
    ],
    [
      { status: "failed", cause: "unauthorized", message: "" } as const,
      "modelUnauthorized",
    ],
    [
      { status: "failed", cause: "rate-limited", message: "" } as const,
      "modelRateLimited",
    ],
    [
      { status: "failed", cause: "network", message: "" } as const,
      "modelOffline",
    ],
    [
      { status: "failed", cause: "server", message: "" } as const,
      "modelUnavailable",
    ],
    [
      { status: "failed", cause: "malformed", message: "" } as const,
      "modelUnusable",
    ],
    [
      { status: "failed", cause: "invalid-output", message: "" } as const,
      "modelUnusable",
    ],
    [
      { status: "failed", cause: "unknown", message: "" } as const,
      "recognitionFailed",
    ],
  ])("maps %o to its own message", (result, expected) => {
    expect(issueForRecognition(result)).toBe(expected);
  });

  // A model that answers with prose and one that answers with a truncated body
  // are the same problem to the person holding the phone: this endpoint's model
  // cannot do the job, try another one.
  it("gives a malformed body and an unusable answer the same advice", () => {
    expect(
      issueForRecognition({
        status: "failed",
        cause: "malformed",
        message: "",
      }),
    ).toBe(
      issueForRecognition({
        status: "failed",
        cause: "invalid-output",
        message: "",
      }),
    );
  });
});
