import { describe, expect, it } from "vitest";

import type { RecognizedAccount } from "@whole/ocr";

import type {
  ModelRecognitionResult,
  RecognitionFailureCause,
} from "@/features/recognition/model-recognition";
import { issueForRecognition } from "@/features/recognition/recognition-issue";

const recognized = (count: number): ModelRecognitionResult => ({
  status: "recognized",
  recognition: {
    accounts: Array.from({ length: count }, (_unused, index) => ({
      accountName: `Account ${index}`,
    })),
  },
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
  // The engine's read rides along on a failure, and whether it is empty is
  // what decides between "check what was filled in" and "nothing was found".
  const failed = (
    cause: RecognitionFailureCause,
    accounts: RecognizedAccount[],
  ): ModelRecognitionResult => ({ status: "failed", cause, accounts });

  it.each([
    ["load-failed", "modelLoadFailed"],
    ["invalid-output", "modelUnusable"],
    ["unknown", "modelInterrupted"],
  ] as const)("maps %s to its own message", (cause, expected) => {
    expect(issueForRecognition(failed(cause, [{ accountName: "A" }]))).toBe(
      expected,
    );
  });

  // A failed result always carries the engine's read, so no cause may map to
  // `recognitionFailed`: its copy says "fill in the details manually" over a
  // form the app just filled in. That key is the uploader's, for the catch
  // clause where recognition threw before anything landed.
  it("never tells the user to fill in a form the engine pre-filled", () => {
    const causes: RecognitionFailureCause[] = [
      "load-failed",
      "invalid-output",
      "unknown",
    ];
    for (const cause of causes) {
      expect(
        issueForRecognition(failed(cause, [{ accountName: "A" }])),
      ).not.toBe("recognitionFailed");
    }
  });

  // The failure messages all say "check what was filled in". When the engine
  // read nothing either, nothing was — and the honest verdict is the same one
  // a clean but empty read gets.
  it.each(["load-failed", "invalid-output", "unknown"] as const)(
    "reports an empty screen when %s left no engine read either",
    (cause) => {
      expect(issueForRecognition(failed(cause, []))).toBe("recognitionEmpty");
    },
  );
});
