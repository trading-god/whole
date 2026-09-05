// Formats the bundled model's size for display ("3.1 GB").
//
// `GB` / `MB` / `B` are SI unit symbols, not copy: they are written the same
// way in both of the app's locales, so they stay literals here rather than
// becoming i18n keys that could only ever hold the same string twice.
//
// A power-of-TEN MB/GB ladder, one decimal: iOS Settings, macOS Finder and
// Android's storage UI all report decimal units, and this number sits beside
// what they say — a binary ladder here would print "2.9 GB" for a file every
// OS surface calls 3.1 GB.
export function formatBytes(bytes: number): string {
  const gb = bytes / 1000 ** 3;
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / 1000 ** 2;
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${bytes} B`;
}
