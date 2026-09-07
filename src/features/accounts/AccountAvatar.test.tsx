import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { AccountAvatar } from "@/features/accounts/AccountAvatar";
import { getAccountAppearance } from "@/features/assets/account-appearance";

const renderedAvatar = async (kind: "cash" | "investment" | "crypto") => {
  const { toJSON } = await render(
    <AccountAvatar kind={kind} name="Daily account" />,
  );
  return toJSON() as unknown as {
    props: { "aria-hidden": boolean; style: unknown[] };
  };
};

describe("AccountAvatar", () => {
  it("shows the account initials", async () => {
    await render(<AccountAvatar kind="cash" name="Daily account" />);

    expect(
      screen.getByText("DA", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it.each(["cash", "investment", "crypto"] as const)(
    "uses the %s kind appearance",
    async (kind) => {
      const avatar = await renderedAvatar(kind);
      const appearance = getAccountAppearance(kind);

      expect(avatar.props.style).toContainEqual({
        backgroundColor: appearance.tint,
      });
      expect(
        screen.getByText("DA", { includeHiddenElements: true }),
      ).toHaveStyle({ color: appearance.color });
    },
  );

  it("is decorative to screen readers", async () => {
    const avatar = await renderedAvatar("cash");

    expect(avatar.props["aria-hidden"]).toBe(true);
  });
});
