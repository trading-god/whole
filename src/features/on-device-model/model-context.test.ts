import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { ANNOTATION_INFERENCE } from "@whole/ocr";
import { ON_DEVICE_CONTEXT_IDLE_RELEASE_MS } from "@/features/on-device-model/model-context";

// llama.rn and the model path are the two seams here, both mocked at the
// boundary: `initLlama` returns a context carrying the completion/release
// methods the lease drives, and `resolveBundledModelPath` answers a fixed
// path.
//
// The lease itself (`withOnDeviceContext`) is module-private, so it is
// exercised through `completeOnDevice` — the only thing that takes it, which
// is the point of it not being exported.
const mockRelease = jest.fn<() => Promise<void>>();
const mockCompletion =
  jest.fn<
    (params: Record<string, unknown>) => Promise<Record<string, unknown>>
  >();
const mockInitLlama =
  jest.fn<(params: Record<string, unknown>) => Promise<unknown>>();
const mockResolveBundledModelPath = jest.fn<() => string>();
const mockInstallJsi = jest.fn<() => Promise<void>>();

jest.mock("llama.rn", () => ({
  initLlama: (params: Record<string, unknown>) => mockInitLlama(params),
  installJsi: () => mockInstallJsi(),
}));

const mockAddEventListener =
  jest.fn<
    (event: string, handler: (state: string) => void) => { remove: () => void }
  >();

// The specific module, never the `react-native` namespace: replacing the
// namespace strips `Platform.select`, which expo-modules-core needs at import
// (see the note in AGENTS.md).
const mockAppState = { currentState: "active" };

jest.mock("react-native/Libraries/AppState/AppState", () => ({
  // `default`, because `react-native`'s index re-exports it as
  // `require(...).default`.
  default: {
    addEventListener: (event: string, handler: (state: string) => void) =>
      mockAddEventListener(event, handler),
    get currentState() {
      return mockAppState.currentState;
    },
  },
}));

jest.mock("@/features/on-device-model/model-source", () => ({
  resolveBundledModelPath: () => mockResolveBundledModelPath(),
}));

const contextInstance = () => ({
  completion: mockCompletion,
  release: mockRelease,
});

// The module caches the context, the JSI install and the release in flight at
// module level, so every case needs a fresh instance or one test's singleton
// leaks into the next.
//
// `require` rather than a dynamic `import()`: Jest runs these as CommonJS, and
// `import()` there fails with "A dynamic import callback was invoked without
// --experimental-vm-modules".
type ContextModule = typeof import("@/features/on-device-model/model-context");
type ErrorModule = typeof import("@/features/on-device-model/model-error");
let contextModule: ContextModule;
// From the SAME fresh graph as the module under test: `instanceof` compares
// class identity, and a statically imported copy is a different class after
// `resetModules`.
let ModelError: ErrorModule["OnDeviceModelError"];

const complete = () => contextModule.completeOnDevice({ prompt: "hi" });
const releaseOnDeviceContext = () => contextModule.releaseOnDeviceContext();
const prewarmOnDeviceContext = () => contextModule.prewarmOnDeviceContext();
const verifyOnDeviceModel = () => contextModule.verifyOnDeviceModel();

// Fake timers, so the idle release is asserted rather than waited a minute for.
// `jest.getTimerCount()` is what "is a release armed?" reads as here.
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockResolveBundledModelPath.mockReturnValue("file:///docs/models/model.gguf");
  mockInstallJsi.mockResolvedValue(undefined);
  mockInitLlama.mockImplementation(async () => contextInstance());
  mockCompletion.mockResolvedValue({ content: "ok" });
  mockRelease.mockResolvedValue(undefined);
  mockAddEventListener.mockReturnValue({ remove: jest.fn() });
  mockAppState.currentState = "active";
  /* eslint-disable @typescript-eslint/no-require-imports -- see above */
  contextModule = require("@/features/on-device-model/model-context");
  ModelError = (
    require("@/features/on-device-model/model-error") as ErrorModule
  ).OnDeviceModelError;
  /* eslint-enable @typescript-eslint/no-require-imports */
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the context lease", () => {
  it("loads the context once and reuses it across uses", async () => {
    await complete();
    await complete();

    expect(mockInitLlama).toHaveBeenCalledTimes(1);
    expect(mockInitLlama).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "file:///docs/models/model.gguf",
        n_ctx: ANNOTATION_INFERENCE.contextWindow,
      }),
    );
  });

  it("arms the idle release when the use succeeds", async () => {
    await complete();

    expect(jest.getTimerCount()).toBe(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("arms the idle release even when the use throws", async () => {
    mockCompletion.mockRejectedValue(new Error("context full"));

    await expect(complete()).rejects.toBeInstanceOf(ModelError);

    // A failed use is the one path that would otherwise leave a loaded
    // context with no timer ever going to free it.
    expect(jest.getTimerCount()).toBe(1);
  });

  it("installs the JSI bindings once across overlapping loads", async () => {
    // llama.rn's own guard is set only after its await resolves, so two
    // overlapping calls both reach the native install — which on Android
    // starts the shard extraction twice, and two threads on one `.part`
    // produce a full-length shard of garbage that no later check catches.
    let releaseInstall: () => void = () => {};
    mockInstallJsi.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseInstall = resolve;
      }),
    );

    const first = complete();
    // A release clears the singleton while the first load is still installing,
    // which is what lets a second load start — the prewarm-then-release path.
    void releaseOnDeviceContext();
    const second = complete();

    releaseInstall();
    await Promise.all([first, second]);

    expect(mockInstallJsi).toHaveBeenCalledTimes(1);
  });

  it("retries the JSI install after it fails", async () => {
    mockInstallJsi.mockRejectedValueOnce(new Error("jsi not installed"));

    await expect(complete()).rejects.toThrow(/jsi not installed/);

    // Not cached as a failure: one bad install must not fail every later load.
    await expect(complete()).resolves.toEqual({ content: "ok" });
    expect(mockInstallJsi).toHaveBeenCalledTimes(2);
  });

  it("installs the JSI bindings before resolving the model path", async () => {
    await complete();

    // On Android the patched module extracts the shards inside `install()`;
    // the filesDir path is unreadable until that has run, so the install must
    // strictly precede the path resolution — or a fresh install deadlocks
    // (path missing → throw → install never reached).
    expect(mockInstallJsi).toHaveBeenCalledTimes(1);
    expect(mockInstallJsi.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveBundledModelPath.mock.invocationCallOrder[0],
    );
  });

  it("cancels the armed idle release for the duration of a use", async () => {
    await complete();

    // A use starting inside the idle window can outlast the timer; firing
    // then would interrupt the completion this very use is running.
    mockCompletion.mockImplementation(async () => {
      expect(jest.getTimerCount()).toBe(0);
      return { content: "ok" };
    });
    await complete();
  });

  it("wraps a failed path resolution as an on-device model error", async () => {
    mockResolveBundledModelPath.mockImplementation(() => {
      throw new Error("copy is not the expected size");
    });

    await expect(complete()).rejects.toThrow(/copy is not the expected size/);
    expect(mockInitLlama).not.toHaveBeenCalled();
  });

  it("wraps a failed load as an on-device model error and retries after it", async () => {
    mockInitLlama.mockRejectedValue(new Error("out of memory"));

    await expect(complete()).rejects.toThrow(/out of memory/);
    // A failed load must not poison the singleton: the next call retries
    // (the user may have freed memory in between).
    mockInitLlama.mockImplementation(async () => contextInstance());
    await complete();
    expect(mockInitLlama).toHaveBeenCalledTimes(2);
  });
});

describe("prewarmOnDeviceContext", () => {
  it("loads the context, and the completion that follows reuses it", async () => {
    prewarmOnDeviceContext();
    await complete();

    expect(mockInitLlama).toHaveBeenCalledTimes(1);
  });

  it("arms the idle release when no completion follows", async () => {
    // The whole point of a prewarm is that the completion has not happened
    // yet — and it may never: the OCR pass beside it can fail. Without a timer
    // of its own the context would sit on gigabytes forever.
    prewarmOnDeviceContext();
    await jest.advanceTimersByTimeAsync(0);

    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(ON_DEVICE_CONTEXT_IDLE_RELEASE_MS);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("does not arm a release into a completion already running", async () => {
    // The prewarm's load resolves while the recognition it was warming for is
    // mid-completion. Arming there would schedule a release into the very
    // completion the context was loaded for.
    let armedDuringCompletion = -1;
    mockCompletion.mockImplementation(async () => {
      armedDuringCompletion = jest.getTimerCount();
      return { content: "ok" };
    });

    prewarmOnDeviceContext();
    await complete();

    expect(armedDuringCompletion).toBe(0);
    expect(jest.getTimerCount()).toBe(1);
  });

  it("arms no timer for a context a concurrent release is already freeing", async () => {
    // The OCR-failure path: the prewarm's load is still running when the
    // release starts, and the release is awaiting that same promise. A timer
    // armed when it resolves would outlive the context it was armed for.
    prewarmOnDeviceContext();
    const releasing = releaseOnDeviceContext();
    await jest.advanceTimersByTimeAsync(0);
    await releasing;

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("swallows a failed load", async () => {
    mockInitLlama.mockRejectedValue(new Error("out of memory"));

    // Fire-and-forget: an unhandled rejection here would crash a screen that
    // has not asked for anything yet. The completion that follows reports it.
    expect(() => prewarmOnDeviceContext()).not.toThrow();
    await expect(complete()).rejects.toThrow(/out of memory/);
  });
});

describe("backgrounding", () => {
  const background = () => {
    mockAppState.currentState = "background";
    mockAddEventListener.mock.calls[0]?.[1]?.("background");
  };

  it("frees the context when the app goes away", async () => {
    // The idle timer cannot: iOS suspends JS timers shortly after the app is
    // backgrounded, so without this the weights are held by a suspended app —
    // which is exactly what gets jetsammed.
    await complete();

    background();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("subscribes once, and only once there is something to free", async () => {
    expect(mockAddEventListener).not.toHaveBeenCalled();

    await complete();
    await complete();

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("leaves a completion in flight alone", async () => {
    // The lease guard is what makes this safe: freeing here would release the
    // context natively out from under the completion running on it.
    let releasedDuringUse: number | undefined;
    mockCompletion.mockImplementation(async () => {
      background();
      await jest.advanceTimersByTimeAsync(0);
      releasedDuringUse = mockRelease.mock.calls.length;
      return { content: "ok" };
    });

    await complete();

    expect(releasedDuringUse).toBe(0);
  });

  it("frees it the moment that completion ends, without a timer", async () => {
    // The deferred case: a background arriving mid-use cannot free anything,
    // and arming a 60s timer instead would not fire before iOS suspends the
    // app — leaving the weights held by a suspended process.
    mockCompletion.mockImplementation(async () => {
      background();
      await jest.advanceTimersByTimeAsync(0);
      return { content: "ok" };
    });

    await complete();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("frees it after EVERY use while the app is away, not just the first", async () => {
    // A recognition retries up to three times. A latch the first attempt
    // consumed would leave the later ones rebuilding the context and then
    // arming a timer a suspended app never runs — which is the whole failure
    // this path exists to prevent.
    mockCompletion.mockImplementationOnce(async () => {
      background();
      await jest.advanceTimersByTimeAsync(0);
      return { content: "ok" };
    });

    await complete();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockRelease).toHaveBeenCalledTimes(1);

    // The retry, still backgrounded.
    await complete();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockRelease).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps the context warm when the app came back before the use ended", async () => {
    const foreground = () => {
      mockAppState.currentState = "active";
      mockAddEventListener.mock.calls[0]?.[1]?.("active");
    };
    mockCompletion.mockImplementation(async () => {
      background();
      await jest.advanceTimersByTimeAsync(0);
      foreground();
      return { content: "ok" };
    });

    await complete();
    await jest.advanceTimersByTimeAsync(0);

    // Back in the foreground, so the next recognition should still skip the
    // multi-second load.
    expect(mockRelease).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });
});

describe("releaseOnDeviceContext", () => {
  it("releases the loaded context exactly once", async () => {
    await complete();

    await releaseOnDeviceContext();

    expect(mockRelease).toHaveBeenCalledTimes(1);
    // A second release is a no-op — the singleton is gone.
    await releaseOnDeviceContext();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("cancels the armed idle release", async () => {
    await complete();

    await releaseOnDeviceContext();

    expect(jest.getTimerCount()).toBe(0);
  });

  it("holds a load arriving during a release behind that release", async () => {
    await complete();

    const release = releaseOnDeviceContext();
    const second = complete();
    // Synchronously after both start: no second load beside the ~3 GB
    // context still being freed.
    expect(mockInitLlama).toHaveBeenCalledTimes(1);

    await release;
    await second;
    expect(mockInitLlama).toHaveBeenCalledTimes(2);
    // And the second load ran strictly after the release settled, not beside
    // it — that is the serialization `releasing` exists for.
    expect(mockRelease.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitLlama.mock.invocationCallOrder[1],
    );
  });

  it("lets the next load through even when the release failed", async () => {
    await complete();
    mockRelease.mockImplementation(async () => {
      throw new Error("native release failed");
    });

    const failing = releaseOnDeviceContext().catch(() => {});
    const next = complete();
    await failing;

    // The load waits for the release only to get the memory back. A release
    // that threw is not a reason to report the model as unloadable.
    await expect(next).resolves.toEqual({ content: "ok" });
  });

  it("does nothing while a use still holds the context", async () => {
    // Freeing under a running completion would release it natively out from
    // under llama.cpp. The prewarm cleanup on the recognition path can land
    // exactly while the settings screen's Test is mid-load.
    let released: boolean | undefined;
    mockCompletion.mockImplementation(async () => {
      await releaseOnDeviceContext();
      released = mockRelease.mock.calls.length > 0;
      return { content: "ok" };
    });

    await complete();

    expect(released).toBe(false);
    // And the lease's own re-arm still happens, so it is not held forever.
    expect(jest.getTimerCount()).toBe(1);
  });

  it("keeps the context reachable when the release fails", async () => {
    await complete();
    mockRelease.mockImplementationOnce(async () => {
      throw new Error("native release failed");
    });

    await expect(releaseOnDeviceContext()).rejects.toThrow(
      "native release failed",
    );

    // The reference is back, so a retry frees the same context rather than
    // leaving it allocated with a second one built beside it.
    await releaseOnDeviceContext();
    expect(mockRelease).toHaveBeenCalledTimes(2);
    expect(mockInitLlama).toHaveBeenCalledTimes(1);
  });

  it("leaves the slot empty when the LOAD is what failed", async () => {
    // The prewarm path: a load fires with no lease, OOMs, and the recognition
    // that never needed it releases. Writing that rejected load back into the
    // singleton would pin its error there and fail every later recognition
    // with no retry for the life of the process.
    mockInitLlama.mockRejectedValue(new Error("out of memory"));
    prewarmOnDeviceContext();

    await expect(releaseOnDeviceContext()).rejects.toThrow("out of memory");

    mockInitLlama.mockImplementation(async () => contextInstance());
    await expect(complete()).resolves.toEqual({ content: "ok" });
    expect(mockInitLlama).toHaveBeenCalledTimes(2);
  });

  it("gives up on a context whose release keeps failing", async () => {
    await complete();
    mockRelease.mockImplementation(async () => {
      throw new Error("native release failed");
    });

    await expect(releaseOnDeviceContext()).rejects.toThrow();
    // The retry the idle timer and the background handler would make. A second
    // failure means the handle is gone; restoring it again would hand every
    // later completion a context llama.cpp no longer holds.
    await expect(releaseOnDeviceContext()).rejects.toThrow();

    mockRelease.mockResolvedValue(undefined);
    await expect(complete()).resolves.toEqual({ content: "ok" });
    expect(mockInitLlama).toHaveBeenCalledTimes(2);
  });

  it("is a no-op with nothing loaded", async () => {
    await expect(releaseOnDeviceContext()).resolves.toBeUndefined();
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

describe("the idle release", () => {
  it("frees the context when it fires", async () => {
    await complete();

    await jest.advanceTimersByTimeAsync(ON_DEVICE_CONTEXT_IDLE_RELEASE_MS);

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("is re-armed by every use, not just the first", async () => {
    const half = ON_DEVICE_CONTEXT_IDLE_RELEASE_MS / 2;
    await complete();
    await jest.advanceTimersByTimeAsync(half);
    await complete();

    // Past when the FIRST use's timer would have fired. Still held, because
    // the second use restarted the clock rather than inheriting it.
    await jest.advanceTimersByTimeAsync(half);
    expect(mockRelease).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(half);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("completeOnDevice", () => {
  it("returns the completion's result", async () => {
    await expect(complete()).resolves.toEqual({ content: "ok" });
    expect(mockCompletion).toHaveBeenCalledWith({ prompt: "hi" });
  });

  it("wraps a failed completion as an on-device model error", async () => {
    mockCompletion.mockRejectedValue(new Error("context full"));

    await expect(complete()).rejects.toBeInstanceOf(ModelError);
    await expect(complete()).rejects.toThrow(/context full/);
  });
});

describe("concurrent completions", () => {
  it("runs them one at a time", async () => {
    // llama.cpp throws "Context is busy" on a second completion against a
    // context already predicting, and the two callers here — the settings
    // Test probe and a recognition started behind it — park on the same
    // context promise and resume together.
    let inFlight = 0;
    let overlapped = false;
    mockCompletion.mockImplementation(async () => {
      inFlight += 1;
      overlapped ||= inFlight > 1;
      await Promise.resolve();
      inFlight -= 1;
      return { content: "ok" };
    });

    await Promise.all([complete(), complete()]);

    expect(overlapped).toBe(false);
    expect(mockCompletion).toHaveBeenCalledTimes(2);
  });

  it("keeps running them after one fails", async () => {
    mockCompletion.mockImplementationOnce(async () => {
      throw new Error("context full");
    });

    await expect(complete()).rejects.toBeInstanceOf(ModelError);
    await expect(complete()).resolves.toEqual({ content: "ok" });
  });
});

describe("verifyOnDeviceModel", () => {
  it("resolves the bundled path and runs a one-token completion", async () => {
    await verifyOnDeviceModel();

    expect(mockInitLlama).toHaveBeenCalledWith(
      expect.objectContaining({ model: "file:///docs/models/model.gguf" }),
    );
    expect(mockCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ n_predict: 1 }),
    );
    // A verification that succeeded still leaves the context held for the
    // first real recognition.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("surfaces a failed load as an on-device model error", async () => {
    mockInitLlama.mockRejectedValue(new Error("corrupt file"));

    await expect(verifyOnDeviceModel()).rejects.toBeInstanceOf(ModelError);
  });

  it("surfaces a failed probe completion as an on-device model error", async () => {
    mockCompletion.mockRejectedValue(new Error("no memory"));

    await expect(verifyOnDeviceModel()).rejects.toBeInstanceOf(ModelError);
  });
});
