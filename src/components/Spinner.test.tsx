import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { Spinner } from "@/components/Spinner";
import { COLORS } from "@/theme/colors";

// React Native's own `ActivityIndicator` draws the platform's spinner, and on
// iOS that is the petal wheel — a different shape from the arc Android draws,
// so the same button spins differently depending on the phone. This draws one
// arc on both.
describe("Spinner", () => {
  it("renders", async () => {
    await render(<Spinner />);

    expect(screen.getByTestId("spinner")).toBeOnTheScreen();
  });

  it("takes a testID so a caller can find its own", async () => {
    await render(<Spinner testID="button-spinner" />);

    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
  });

  // Sized and coloured like the glyph it stands in for, so it sits in a
  // button's icon slot without changing the metrics around it.
  it("draws at the size and colour it is given", async () => {
    const { toJSON } = await render(<Spinner size={16} color={COLORS.brand} />);
    const svg = JSON.stringify(toJSON());

    expect(svg).toContain('"width":16');
    expect(svg).toContain(COLORS.brand);
  });
});
