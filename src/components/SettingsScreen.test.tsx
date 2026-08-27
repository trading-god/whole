import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ProviderConfig } from "@whole/llm";

import { SettingsScreen } from "@/components/SettingsScreen";
import { renderWithProviders } from "@/test-support/render";
import { TONES } from "@/theme/tones";

const mockLoadProviderConfig = jest.fn<() => Promise<ProviderConfig | null>>();
const mockSaveProviderConfig = jest.fn<(c: ProviderConfig) => Promise<void>>();
const mockRecordConsent = jest.fn<(host: string) => Promise<void>>();
const mockProbeEndpoint = jest.fn<() => Promise<unknown>>();
const mockReturnToOverview = jest.fn();

jest.mock("@/features/assets/model-provider-store", () => ({
  loadProviderConfig: () => mockLoadProviderConfig(),
  saveProviderConfig: (c: ProviderConfig) => mockSaveProviderConfig(c),
  recordConsent: (host: string) => mockRecordConsent(host),
}));

jest.mock("@/features/assets/model-probe", () => ({
  probeConfiguredEndpoint: () => mockProbeEndpoint(),
}));

jest.mock("@/navigation/useReturnToOverview", () => ({
  useReturnToOverview: () => mockReturnToOverview,
}));

const STORED: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
  structuredOutput: "json_schema",
};

// `fireEvent` is async in @testing-library/react-native v14, exactly like
// `render`. Without the await the state update has not flushed, and the
// assertion reads the previous render — which looks like the component
// ignoring the input.
const type = async (label: string, value: string) => {
  await fireEvent.changeText(screen.getByLabelText(label), value);
};

const press = async (label: string) => {
  await fireEvent.press(screen.getByText(label));
};

// Labels are asserted in ENGLISH: `useLocales()` resolves to `en` under
// jest-expo, so that is the copy this suite actually renders. Asserting real
// copy rather than a test-id is the point — a missing key would surface here as
// a raw key instead of shipping as one.
const fillValidEndpoint = async () => {
  await type("Endpoint", "https://api.example.com/v1");
  await type("Model", "gpt-5.6");
};

const openStored = async () => {
  mockLoadProviderConfig.mockResolvedValue(STORED);
  await renderWithProviders(<SettingsScreen />);
  await screen.findByDisplayValue("https://api.example.com/v1");
};

beforeEach(() => {
  // `clearAllMocks`, not `resetAllMocks`: resetting wipes jest-expo's own
  // automatic mocks too, and `useLocales()` then returns undefined — which
  // surfaces as "preferred is not iterable" from deep inside the i18n provider,
  // nowhere near the line that caused it.
  jest.clearAllMocks();
  mockLoadProviderConfig.mockResolvedValue(null);
  mockSaveProviderConfig.mockResolvedValue(undefined);
  mockRecordConsent.mockResolvedValue(undefined);
  mockProbeEndpoint.mockResolvedValue({ ok: true, mode: "json_schema" });
});

describe("the settings form", () => {
  it("opens empty when nothing is configured", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByLabelText("Endpoint")).toHaveDisplayValue("");
  });

  it("opens filled from a stored configuration", async () => {
    await openStored();

    expect(screen.getByLabelText("Model")).toHaveDisplayValue("gpt-5.6");
  });
});

// Two independent conditions, and the second is what stops the screen offering
// to re-save something it just loaded.
describe("when save is available", () => {
  it("is unavailable while the form is incomplete", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByLabelText("Save")).toBeDisabled();
  });

  // Re-entering the screen and tapping Save would otherwise re-test and
  // re-write a configuration nobody touched.
  it("is unavailable on a stored configuration nobody has edited", async () => {
    await openStored();

    expect(screen.getByLabelText("Save")).toBeDisabled();
  });

  it("becomes available once something is edited", async () => {
    await openStored();

    await type("Model", "gpt-5.6-mini");

    expect(screen.getByLabelText("Save")).not.toBeDisabled();
  });

  // Edited back to what is on disk is the same as never edited.
  it("goes unavailable again when the edit is undone", async () => {
    await openStored();

    await type("Model", "something-else");
    await type("Model", "gpt-5.6");

    expect(screen.getByLabelText("Save")).toBeDisabled();
  });

  // `z.url()` alone reads "localhost:11434" as a URL whose scheme is
  // "localhost" — it would save and then never work.
  it("is unavailable for an address with no scheme", async () => {
    await renderWithProviders(<SettingsScreen />);

    await type("Endpoint", "localhost:11434");
    await type("Model", "llama");

    expect(screen.getByLabelText("Save")).toBeDisabled();
  });

  it("goes unavailable again after a successful save", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText("Saved");
    expect(screen.getByLabelText("Save")).toBeDisabled();
  });
});

// The two buttons run the same probe and report it in their own labels. A
// shared spinner would have the test button claiming to be working when the
// user pressed Save, and vice versa.
describe("the test button", () => {
  it("is unavailable while the form is incomplete", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("Test")).toBeDisabled();
  });

  // Unlike Save, testing an unchanged configuration is a reasonable thing to
  // want: it asks whether the endpoint is up right now.
  it("is available on a stored configuration nobody has edited", async () => {
    await openStored();

    expect(screen.getByText("Test")).not.toBeDisabled();
  });

  it("reports a passing endpoint on itself", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");

    await screen.findByText("Passed");
  });

  it("reports a failing endpoint on itself", async () => {
    mockProbeEndpoint.mockResolvedValue({ ok: false, kind: "network" });
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");

    await screen.findByText("Failed");
  });

  // A red button says the endpoint did not answer. It cannot say whether to
  // retype a key, wait for a quota, or fix the address — and under a
  // bring-your-own endpoint the user is the only person who can do any of them.
  it.each<[string, string, RegExp]>([
    ["a rejected key", "unauthorized", /API key rejected/],
    ["an exhausted quota", "rate-limited", /Out of quota/],
    ["an unreachable host", "network", /reach the endpoint/],
    ["an unusable answer", "malformed", /not usably/],
  ])("explains %s underneath", async (_label, kind, message) => {
    mockProbeEndpoint.mockResolvedValue({ ok: false, kind });
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");

    await screen.findByText(message);
  });

  // The verdict is about the endpoint as it was configured a moment ago, so it
  // does not sit there over a form the user has since changed.
  it("returns to its resting label after a few seconds", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");
    await screen.findByText("Passed");

    // Real timers, and a real wait: fake timers here fight
    // @testing-library/react-native's own async render, which schedules its
    // flushes on the same clock. The per-case timeout passed below is larger
    // than this wait — Jest's own default is 5000ms too, so the case would
    // otherwise time out before `waitFor` could finish.
    await waitFor(() => expect(screen.getByText("Test")).toBeOnTheScreen(), {
      timeout: 5000,
    });
  }, 10000);

  it("leaves the save button alone while it works", async () => {
    let releaseProbe!: (result: unknown) => void;
    mockProbeEndpoint.mockReturnValue(
      new Promise((resolve) => {
        releaseProbe = resolve;
      }),
    );
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");

    // Something VISIBLE, not just `accessibilityState.busy`. Asserting only
    // the a11y flag is how `loading` shipped rendering nothing at all: the
    // test passed while a sighted user saw the button quietly stop responding.
    //
    // The label goes while it works — on a button this small the spinner has
    // already said "in progress", and the word only made it jump wider.
    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(screen.queryByText("Test")).toBeNull();
    expect(screen.getByLabelText("Save")).not.toBeBusy();

    releaseProbe({ ok: true, mode: "json_schema" });
    await screen.findByText("Passed");
  });
});

describe("saving", () => {
  it("stores the endpoint and records consent for its host", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText("Saved");
    expect(mockSaveProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://api.example.com/v1" }),
    );
    expect(mockRecordConsent).toHaveBeenCalledWith("api.example.com");
  });

  // Saving an endpoint nobody has confirmed works stores something that looks
  // enabled and fails at the first screenshot — by which point the user has
  // left this screen and has no reason to connect the two.
  it("tests on the user's behalf when they have not", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText("Saved");
    expect(mockProbeEndpoint).toHaveBeenCalledTimes(1);
  });

  // That auto-test is a round trip, and it is the SAVE button the user pressed.
  it("reports the auto-test on the save button", async () => {
    let releaseProbe!: (result: unknown) => void;
    mockProbeEndpoint.mockReturnValue(
      new Promise((resolve) => {
        releaseProbe = resolve;
      }),
    );
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    expect(screen.getByLabelText("Save")).toBeBusy();
    // The spinner is on the SAVE button, and that button NAMES what it is
    // doing — a spinner alone says something is happening, not what. The test
    // button is meanwhile sitting at its resting label.
    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(screen.getByText("Testing")).toBeOnTheScreen();
    expect(screen.getByText("Test")).toBeOnTheScreen();

    releaseProbe({ ok: true, mode: "json_schema" });
    await screen.findByText("Saved");
  });

  it("does not test again when the user already did", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");
    await screen.findByText("Passed");
    await press("Save");

    await screen.findByText("Saved");
    expect(mockProbeEndpoint).toHaveBeenCalledTimes(1);
  });

  // A passing test describes the endpoint as it was configured then.
  it("tests again when the endpoint changed after a passing test", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Test");
    await screen.findByText("Passed");
    await type("Model", "another-model");
    await press("Save");

    await screen.findByText("Saved");
    expect(mockProbeEndpoint).toHaveBeenCalledTimes(2);
  });

  // The tier is a property of the endpoint, so it is stored with it — the
  // recognition path must never re-discover it per screenshot.
  it("stores the tier the probe found", async () => {
    mockProbeEndpoint.mockResolvedValue({ ok: true, mode: "tool" });
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText("Saved");
    expect(mockSaveProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ structuredOutput: "tool" }),
    );
  });

  // A configuration the endpoint rejected would sit there looking enabled and
  // fail on every screenshot.
  it("refuses to store an endpoint that failed its test", async () => {
    mockProbeEndpoint.mockResolvedValue({ ok: false, kind: "unauthorized" });
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText(/API key rejected/);
    expect(mockSaveProviderConfig).not.toHaveBeenCalled();
    expect(mockRecordConsent).not.toHaveBeenCalled();
  });

  // A failed write must not leave the screen claiming the endpoint is on, and
  // consent is not recorded because nothing was stored to consent to.
  it("reports a write that failed", async () => {
    mockSaveProviderConfig.mockRejectedValue(new Error("keychain locked"));
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Save");

    await screen.findByText(/Couldn't save/);
    expect(mockRecordConsent).not.toHaveBeenCalled();
  });
});

describe("leaving", () => {
  it("goes back without saving", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    await press("Cancel");

    expect(mockReturnToOverview).toHaveBeenCalled();
    expect(mockSaveProviderConfig).not.toHaveBeenCalled();
  });
});

// Selection is DERIVED from the form, not remembered: a preset is active while
// the address and protocol still match it, and stops being active the moment
// the user edits either.
describe("the preset row", () => {
  it("marks the preset the form currently matches", async () => {
    await renderWithProviders(<SettingsScreen />);

    await press("Ollama");

    expect(screen.getByLabelText("Ollama")).toBeSelected();
    expect(screen.getByLabelText("LM Studio")).not.toBeSelected();
  });

  it("drops the mark once the address is edited", async () => {
    await renderWithProviders(<SettingsScreen />);

    await press("Ollama");
    await type("Endpoint", "http://localhost:9999/v1");

    expect(screen.getByLabelText("Ollama")).not.toBeSelected();
  });

  it("fills the protocol along with the address", async () => {
    await renderWithProviders(<SettingsScreen />);

    await press("Anthropic");
    await type("Model", "claude");
    await press("Save");

    await screen.findByText("Saved");
    expect(mockSaveProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ api: "anthropic-messages" }),
    );
  });
});

describe("the privacy notice", () => {
  it("names an external host and says the text leaves", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    expect(screen.getByText(/api\.example\.com/)).toBeOnTheScreen();
    expect(screen.getByText(/is sent to/)).toBeOnTheScreen();
  });

  it("says a loopback address keeps everything on the device", async () => {
    await renderWithProviders(<SettingsScreen />);

    await press("Ollama");

    expect(screen.getByText(/Nothing leaves this device/)).toBeOnTheScreen();
  });

  // What leaves is the recognized TEXT, not the image — a real difference the
  // copy should not blur.
  it("says the screenshot itself never leaves", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    expect(screen.getByText(/screenshot never leaves/)).toBeOnTheScreen();
  });

  // The colour is part of the message. A block that says "this leaves your
  // device" on the same reassuring green as one that says it does not makes the
  // distinction something the user has to READ rather than see.
  it("paints itself by where the data actually goes", async () => {
    await renderWithProviders(<SettingsScreen />);
    await fillValidEndpoint();

    expect(screen.getByTestId("endpoint-notice")).toHaveStyle({
      backgroundColor: TONES.caution.surface,
    });

    await press("Ollama");

    expect(screen.getByTestId("endpoint-notice")).toHaveStyle({
      backgroundColor: TONES.safe.surface,
    });
  });

  it("says nothing until there is a host to name", async () => {
    await renderWithProviders(<SettingsScreen />);

    expect(screen.queryByTestId("endpoint-notice")).toBeNull();
  });
});
