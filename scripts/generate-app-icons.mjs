import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(projectRoot, "assets/branding/whole-logo.svg");
const sourceSvg = await readFile(sourcePath, "utf8");
const monochromeSvg = sourceSvg.replaceAll(
  /fill="url\(#[^"]+\)"/g,
  'fill="#000000"',
);

const colors = {
  background: "#FFFFFF",
};
const androidSafeScale = 66 / 108;

const iosIcons = [
  ["assets/app-icons/ios/icon-20@2x.png", 40],
  ["assets/app-icons/ios/icon-20@3x.png", 60],
  ["assets/app-icons/ios/icon-29@2x.png", 58],
  ["assets/app-icons/ios/icon-29@3x.png", 87],
  ["assets/app-icons/ios/icon-40@2x.png", 80],
  ["assets/app-icons/ios/icon-40@3x.png", 120],
  ["assets/app-icons/ios/icon-60@2x.png", 120],
  ["assets/app-icons/ios/icon-60@3x.png", 180],
  ["assets/app-icons/ios/icon-76.png", 76],
  ["assets/app-icons/ios/icon-76@2x.png", 152],
  ["assets/app-icons/ios/icon-83.5@2x.png", 167],
  ["assets/app-icons/ios/icon-1024.png", 1024],
];

const androidLegacyIcons = [
  ["assets/app-icons/android/legacy/mipmap-mdpi.png", 48],
  ["assets/app-icons/android/legacy/mipmap-hdpi.png", 72],
  ["assets/app-icons/android/legacy/mipmap-xhdpi.png", 96],
  ["assets/app-icons/android/legacy/mipmap-xxhdpi.png", 144],
  ["assets/app-icons/android/legacy/mipmap-xxxhdpi.png", 192],
];

const androidAdaptiveIcons = [
  ["mdpi", 108],
  ["hdpi", 162],
  ["xhdpi", 216],
  ["xxhdpi", 324],
  ["xxxhdpi", 432],
];

const webIcons = [
  ["public/icons/favicon-16.png", 16, 0.9],
  ["public/icons/favicon-32.png", 32, 0.9],
  ["public/icons/favicon-48.png", 48, 0.9],
  ["public/icons/apple-touch-icon-180.png", 180, 0.8],
  ["public/icons/pwa-192.png", 192, 0.8],
  ["public/icons/pwa-512.png", 512, 0.8],
];

// Transparent (when `background` is null) or solid-fill RGBA canvas. Shared by
// `renderIcon` and `renderSplashIcon` so the create-config lives in one place.
function createCanvas(size, background) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

// Writes a PNG at compression level 9, creating parent dirs as needed.
async function writePng(image, output) {
  const outputPath = resolve(projectRoot, output);
  await mkdir(dirname(outputPath), { recursive: true });
  await image.png({ compressionLevel: 9 }).toFile(outputPath);
}

// Rasterizes an SVG to a square PNG buffer at `size`, preserving aspect ratio
// (`fit: "contain"` never crops the artwork). Shared by `renderIcon` (artwork)
// and `renderSplashIcon` (logo) so the rasterize params live in one place.
function rasterizeSvg(svg, size) {
  return sharp(Buffer.from(svg))
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

async function renderIcon({
  output,
  size,
  scale,
  svg = sourceSvg,
  background = colors.background,
}) {
  const artworkSize = Math.round(size * scale);
  const artwork = await rasterizeSvg(svg, artworkSize);

  let image = createCanvas(size, background).composite([
    { input: artwork, gravity: "center" },
  ]);

  if (background) {
    image = image.flatten({ background }).removeAlpha();
  }

  await writePng(image, output);
}

// Splash icon composites the logo with the WHOLE wordmark and slogan so the
// native launch screen reads as a complete brand mark (logo-only felt sparse).
// Drawn on a transparent 1024² canvas; the launch screen `backgroundColor`
// fills behind it. Text is baked as bitmap, so the slogan stays in the
// canonical English brand copy (AGENTS.md) and the wordmark treatment mirrors
// `screenStyles.wordmark` — brand color, extrabold, wide tracking scaled to
// the baked font size.
async function renderSplashIcon({ output, size }) {
  const logoSize = Math.round(size * 0.47);
  const fontFamily = "Helvetica Neue, Helvetica, Arial, sans-serif";
  const wordmarkSize = Math.round(size * 0.082);
  const wordmarkTracking = Math.round(size * 0.0137);
  const sloganSize = Math.round(size * 0.04);
  const cx = size / 2;

  const textSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
<text x="${cx}" y="${Math.round(size * 0.73)}" font-family="${fontFamily}" font-size="${wordmarkSize}" font-weight="800" letter-spacing="${wordmarkTracking}" fill="#098765" text-anchor="middle">WHOLE</text>
<text x="${cx}" y="${Math.round(size * 0.8)}" font-family="${fontFamily}" font-size="${sloganSize}" font-weight="500" fill="#14231D" text-anchor="middle">Your whole financial life,</text>
<text x="${cx}" y="${Math.round(size * 0.845)}" font-family="${fontFamily}" font-size="${sloganSize}" font-weight="500" fill="#14231D" text-anchor="middle">in one place.</text>
</svg>`;

  // Logo and wordmark are independent pipelines — rasterize them in parallel
  // rather than awaiting one before starting the other.
  const [logo, textImage] = await Promise.all([
    rasterizeSvg(sourceSvg, logoSize),
    sharp(Buffer.from(textSvg)).png().toBuffer(),
  ]);

  const logoLeft = Math.round((size - logoSize) / 2);
  const logoTop = Math.round(size * 0.14);

  const image = createCanvas(size).composite([
    { input: logo, left: logoLeft, top: logoTop },
    { input: textImage },
  ]);

  await writePng(image, output);
}

const jobs = [
  // Expo/EAS consumes these five master assets.
  renderIcon({ output: "assets/images/icon.png", size: 1024, scale: 0.8 }),
  renderSplashIcon({
    output: "assets/images/splash-icon.png",
    size: 1024,
  }),
  renderIcon({
    output: "assets/images/android-icon-foreground.png",
    size: 1024,
    scale: androidSafeScale,
    background: null,
  }),
  renderIcon({
    output: "assets/images/android-icon-monochrome.png",
    size: 1024,
    scale: androidSafeScale,
    svg: monochromeSvg,
    background: null,
  }),
  renderIcon({ output: "assets/images/favicon.png", size: 48, scale: 0.9 }),
  renderIcon({
    output: "assets/app-icons/android/play-store-512.png",
    size: 512,
    scale: 0.8,
  }),

  ...iosIcons.map(([output, size]) => renderIcon({ output, size, scale: 0.8 })),
  ...androidLegacyIcons.map(([output, size]) =>
    renderIcon({ output, size, scale: 0.8 }),
  ),
  ...androidAdaptiveIcons.flatMap(([density, size]) => [
    renderIcon({
      output: `assets/app-icons/android/adaptive/foreground-${density}.png`,
      size,
      scale: androidSafeScale,
      background: null,
    }),
    renderIcon({
      output: `assets/app-icons/android/adaptive/monochrome-${density}.png`,
      size,
      scale: androidSafeScale,
      svg: monochromeSvg,
      background: null,
    }),
  ]),
  ...webIcons.map(([output, size, scale]) =>
    renderIcon({ output, size, scale }),
  ),
  renderIcon({
    output: "public/icons/pwa-maskable-192.png",
    size: 192,
    scale: androidSafeScale,
  }),
  renderIcon({
    output: "public/icons/pwa-maskable-512.png",
    size: 512,
    scale: androidSafeScale,
  }),
];

await Promise.all(jobs);
console.log(`Generated ${jobs.length} app icons from ${sourcePath}`);
