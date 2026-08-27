import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Platform, Text } from "react-native";

import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";

// React Native's own KeyboardAvoidingView consumes `behavior` internally and
// renders a plain View, so the resolved value never appears in the rendered
// tree. Standing in for it is the only way to observe what this wrapper decided.
const mockKeyboardAvoidingView = jest.fn();

jest.mock(
  "react-native/Libraries/Components/Keyboard/KeyboardAvoidingView",
  () => ({
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockKeyboardAvoidingView(props);
      // Required at call time, not at module scope: the factory is hoisted
      // above every import, so a module-scope `View` would not exist yet.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
      const { View } = require("react-native") as typeof import("react-native");
      return <View>{props.children as React.ReactNode}</View>;
    },
  }),
);

const resolvedBehavior = async (
  props: Parameters<typeof KeyboardAvoidingView>[0] = {},
) => {
  mockKeyboardAvoidingView.mockClear();
  await render(
    <KeyboardAvoidingView {...props}>
      <Text>form</Text>
    </KeyboardAvoidingView>,
  );
  const [received] = mockKeyboardAvoidingView.mock.calls.at(-1) as [
    { behavior?: string },
  ];
  return received.behavior;
};

// The one place the `Platform.OS` branch for keyboard avoidance lives. Both
// arms are reachable because the suite runs once per platform project.
describe("KeyboardAvoidingView", () => {
  it("picks the platform's own default behavior", async () => {
    if (Platform.OS === "ios") {
      // "padding" keeps the keyboard off the focused input.
      expect(await resolvedBehavior()).toBe("padding");
      return;
    }

    // Android handles its insets differently; "padding" there double-offsets.
    expect(await resolvedBehavior()).toBeUndefined();
  });

  it("lets a screen override the behavior", async () => {
    expect(await resolvedBehavior({ behavior: "height" })).toBe("height");
  });

  it("passes the rest of its props through", async () => {
    await render(
      <KeyboardAvoidingView testID="shell">
        <Text>form</Text>
      </KeyboardAvoidingView>,
    );

    const [received] = mockKeyboardAvoidingView.mock.calls.at(-1) as [
      { testID?: string },
    ];
    expect(received.testID).toBe("shell");
  });
});
