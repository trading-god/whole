import { describe, expect, it } from "vitest";

import { formatBytes } from "@/features/on-device-model/format-bytes";

describe("formatBytes", () => {
  it("renders gigabytes with one decimal, in the OS's decimal units", () => {
    // What iOS Settings and Finder would call this file, not 2.9 GiB.
    expect(formatBytes(3_106_738_592)).toBe("3.1 GB");
  });

  it("renders megabytes below a gigabyte", () => {
    expect(formatBytes(12_582_912)).toBe("12.6 MB");
  });

  it("renders raw bytes below a megabyte", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
});
