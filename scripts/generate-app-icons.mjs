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

// Transparent (when `background` is null) or solid-fill RGBA canvas. Shared by
// every job below so the create-config lives in one place.
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
// (`fit: "contain"` never crops the artwork). Every job rasterizes through
// this one place.
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

// The splash asset on BOTH platforms is the logo alone, full-bleed on a
// transparent 1024² canvas (`scale: 1, background: null` — full-size artwork
// on a transparent canvas, no flatten). The wordmark and slogan are NOT
// baked: they are rendered by the JS-side BrandSplash overlay
// (src/components/BrandSplash.tsx) so copy lives in i18n and stays editable
// without regenerating assets.
//
// Android 12+ shows `windowSplashScreenAnimatedIcon` through a circular mask
// (a 288dp canvas of which only the central 192dp-diameter circle is visible).
// Per Expo's splash guidance the image is drawn at `imageWidth: 192` — the
// safe-circle diameter, the largest size that is never cropped. That same 192
// is BrandSplash's LOGO_SIZE: matching the native size is what makes the
// native→JS handoff seamless (a guard test in BrandSplash.test.tsx pins the
// two together). iOS shows the same image unmasked at the same width.

const jobs = [
  // Expo/EAS consumes these four master assets. The splash logo is the plain
  // logo at scale 1 on transparency — see the comment block above for why the
  // splash is the logo alone.
  renderIcon({ output: "assets/images/icon.png", size: 1024, scale: 0.8 }),
  renderIcon({
    output: "assets/images/logo.png",
    size: 1024,
    scale: 1,
    background: null,
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
];

await Promise.all(jobs);
console.log(`Generated ${jobs.length} app icons from ${sourcePath}`);
