import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { Button } from "@/components/Button";

// Globals are imported rather than ambient, matching how the Vitest suites
// import from "vitest". It keeps `@types/jest` out of the global scope, where
// it would otherwise type `describe`/`expect` for the Vitest files too.
//
// `render` is ASYNC in @testing-library/react-native v14 — it returns a promise
// so React 19 can flush concurrently. Forgetting the `await` does not throw; it
// silently leaves `screen` unpopulated and every query then fails with
// "`render` function has not been called".
describe("Button", () => {
  it("renders its label", async () => {
    await render(<Button>Save</Button>);

    expect(screen.getByText("Save")).toBeOnTheScreen();
  });

  it("calls onPress when pressed", async () => {
    const onPress = jest.fn();
    await render(<Button onPress={onPress}>Save</Button>);

    fireEvent.press(screen.getByText("Save"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // `loading` promised a loading state and delivered only an invisible one:
  // it kept the variant, blocked the press, and set `accessibilityState.busy`.
  // A sighted user pressing Save saw nothing happen and a button that had
  // quietly stopped responding.
  describe("while loading", () => {
    it("shows a spinner", async () => {
      await render(<Button loading>Save</Button>);

      expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    });

    it("shows none when it is not loading", async () => {
      await render(<Button>Save</Button>);

      expect(screen.queryByTestId("button-spinner")).toBeNull();
    });

    // The label the caller gives it stays, because a spinner alone says
    // something is happening and not WHAT. Callers pass a label describing the
    // action — "Saving" rather than the resting "Save" — so the row changing
    // reads as the state changing, instead of the label mysteriously shifting.
    it("keeps the label it is given", async () => {
      await render(<Button loading>Saving</Button>);

      expect(screen.getByText("Saving")).toBeOnTheScreen();
    });

    // The spinner occupies the LEADING ICON SLOT — same position, same size
    // token, same gap — rather than being a second thing beside it. That is
    // what keeps a button with an icon from changing width mid-press.
    it("takes the leading icon's place", async () => {
      await render(
        <Button loading icon="check">
          Saving
        </Button>,
      );

      expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
      expect(screen.queryByTestId("button-icon")).toBeNull();
    });

    // A compact control may want the spinner alone. Rendering an empty label
    // box anyway was the centring bug: it still took its gap and pushed the
    // spinner off-centre.
    it("renders no label box when given no label", async () => {
      const { toJSON } = await render(<Button loading />);

      expect(JSON.stringify(toJSON())).not.toContain('"Text"');
    });

    // Found by testID, because the label it would otherwise be found by is
    // exactly what loading hides.
    it("still refuses the press", async () => {
      const onPress = jest.fn();
      await render(
        <Button loading testID="save" onPress={onPress}>
          Save
        </Button>,
      );

      fireEvent.press(screen.getByTestId("save"));

      expect(onPress).not.toHaveBeenCalled();
    });

    it("always announces busy even if a caller passes a stale value", async () => {
      await render(
        <Button
          accessibilityState={{ busy: false, selected: true }}
          loading
          testID="save"
        >
          Save
        </Button>,
      );

      expect(screen.getByTestId("save").props.accessibilityState).toMatchObject(
        {
          busy: true,
          selected: true,
        },
      );
    });
  });

  it("does not call onPress while disabled", async () => {
    const onPress = jest.fn();
    await render(
      <Button disabled onPress={onPress}>
        Save
      </Button>,
    );

    fireEvent.press(screen.getByText("Save"));

    expect(onPress).not.toHaveBeenCalled();
  });
});
