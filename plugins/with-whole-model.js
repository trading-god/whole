// Bundles the on-device model weights into the native projects.
//
// The weights deliberately DO NOT travel through Metro: the asset pipeline
// reads each file in full at several stages, and Node's limits on that read
// (2 GiB `readFile`, then the 512 M-character string cap) make any gguf over
// a few hundred megabytes unbundlable — a 3 GB model cannot ship this way.
// Instead the shards are copied into the native bundles at prebuild:
//
//   - Android: `android/app/src/main/assets/whole_models/` — packaged into
//     the APK, extracted to filesDir by the patched llama.rn module at
//     install time (see patches/).
//
//     KNOWN LIMIT: this puts the weights in the app bundle's BASE module, and
//     Google Play caps that at 150 MB. So an Android build made this way
//     installs from a dev build or a sideloaded APK but cannot be uploaded to
//     Play as is; shipping there means moving the shards into Play Asset
//     Delivery packs (≤1 GB each) and resolving their extracted path instead.
//     iOS has no equivalent cap.
//   - iOS: files added to the Xcode project's resources; llama.rn's own
//     `is_model_asset` flag resolves the model against `[NSBundle mainBundle]`
//     natively.
//
// The shards themselves live in `assets/models/` (Git LFS) as the single copy
// in the repo; this plugin is their only consumer, and it reads the directory
// rather than re-declaring the file names.
const fs = require("node:fs");
const path = require("node:path");

const {
  withAppBuildGradle,
  withDangerousMod,
  withXcodeProject,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const SHARDS_DIR = "assets/models";

// The shards to bundle, derived from the directory: the `-00001-of-000NN`
// naming zero-pads, so a plain sort keeps the first shard first — the one
// llama.cpp is pointed at and the Android copy is named after. The app-side
// catalog (`on-device-catalog.ts`) declares the same files with sizes; this
// plugin runs at prebuild under plain `require`, which cannot load TypeScript.
function listShards(projectRoot) {
  const dir = path.join(projectRoot, SHARDS_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    throw new Error(
      `The bundled model directory is missing: ${dir}. The weights live in ${SHARDS_DIR}/ under Git LFS — run \`git lfs pull\`.`,
    );
  }
  const shards = entries.filter((name) => name.endsWith(".gguf")).sort();
  if (shards.length === 0) {
    throw new Error(
      `No model shards in ${dir} — run \`git lfs pull\` to fetch the weights.`,
    );
  }
  // A clone without `git lfs pull` leaves the shard NAMES in place, holding a
  // ~130-byte pointer file each. Everything downstream accepts them — the
  // same-size skip below, the APK, the Xcode project — and the first sign of
  // trouble is llama.cpp failing to parse a "model" on device. The pointer's
  // first line is a fixed string, so the check costs one small read per shard.
  const pointer = "version https://git-lfs.github.com/spec/v1";
  for (const name of shards) {
    const head = Buffer.alloc(pointer.length);
    const handle = fs.openSync(path.join(dir, name), "r");
    try {
      fs.readSync(handle, head, 0, head.length, 0);
    } finally {
      fs.closeSync(handle);
    }
    if (head.toString("utf8") === pointer) {
      throw new Error(
        `${name} is a Git LFS pointer, not the weights — run \`git lfs pull\` in ${dir}.`,
      );
    }
  }
  return shards;
}

function copyShards(projectRoot, destinationDir, shardNames, { prune }) {
  fs.mkdirSync(destinationDir, { recursive: true });
  // A previous quant's shards first: the names carry the quantization, so a
  // model change renames every file and the old set would otherwise sit beside
  // the new one — doubling the APK, and doubling again when the patched module
  // extracts both into filesDir.
  //
  // Android only. On iOS the pbxproj holds a reference per shard and this
  // plugin only ever ADDS them, so deleting a file the project still names
  // fails the Xcode build outright — worse than the bloat. A quant change
  // needs `expo prebuild --clean` for iOS; Android is fine incrementally.
  const keep = new Set(shardNames);
  if (prune) {
    for (const name of fs.readdirSync(destinationDir)) {
      if (name.endsWith(".gguf") && !keep.has(name)) {
        fs.rmSync(path.join(destinationDir, name));
      }
    }
  }
  for (const name of shardNames) {
    const source = path.join(projectRoot, SHARDS_DIR, name);
    const destination = path.join(destinationDir, name);
    // Skip a copy that is already there at the same size: prebuild without
    // --clean re-runs this plugin, and re-copying ~3 GB per platform is pure
    // I/O. A changed quant changes every shard's size, so the skip never
    // masks a real update.
    if (
      fs.existsSync(destination) &&
      fs.statSync(destination).size === fs.statSync(source).size
    ) {
      continue;
    }
    fs.copyFileSync(source, destination);
  }
}

// Quantized weights are already near-incompressible, so aapt2 deflating them
// spends real build time to save almost nothing — and the extraction then has
// to inflate rather than stream a stored entry. `.gguf` is not in AGP's default
// no-compress set, so it is added here, beside the copy that puts them there.
//
// Appended as its own `android { }` block rather than edited into the
// template's: repeating the block is legal Groovy and reaches the same
// extension object, and it means no anchor in a generated file to go stale.
// `.add(...)` rather than `+=`: AGP declares `noCompress` as a read-only
// `MutableCollection<String>`, so whether `+=` resolves through a setter
// depends on the AGP version — adding to the collection always works.
const NO_COMPRESS_MARKER =
  "// with-whole-model: keep the gguf shards stored, not deflated";

function withUncompressedShards(gradle) {
  if (gradle.includes(NO_COMPRESS_MARKER)) {
    return gradle;
  }
  return `${gradle}
${NO_COMPRESS_MARKER}
android {
    androidResources {
        noCompress.add('.gguf')
    }
}
`;
}

const withWholeModelGradle = (config) =>
  withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language === "groovy") {
      modConfig.modResults.contents = withUncompressedShards(
        modConfig.modResults.contents,
      );
    }
    return modConfig;
  });

const withWholeModelAndroid = (config) =>
  withDangerousMod(config, [
    "android",
    (modConfig) => {
      copyShards(
        modConfig.modRequest.projectRoot,
        path.join(
          modConfig.modRequest.projectRoot,
          "android",
          "app",
          "src",
          "main",
          "assets",
          "whole_models",
        ),
        listShards(modConfig.modRequest.projectRoot),
        { prune: true },
      );
      return modConfig;
    },
  ]);

const withWholeModelIos = (config) => {
  // The shards must exist in the ios/ tree before the Xcode project refers to
  // them; the project mod that follows registers them as resources.
  config = withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const platformProjectRoot = modConfig.modRequest.platformProjectRoot;
      const projectName = modConfig.modRequest.projectName;
      if (!projectName) {
        throw new Error("withWholeModel: the iOS project name is unknown.");
      }
      copyShards(
        modConfig.modRequest.projectRoot,
        path.join(platformProjectRoot, projectName),
        listShards(modConfig.modRequest.projectRoot),
        { prune: false },
      );
      return modConfig;
    },
  ]);

  config = withXcodeProject(config, (modConfig) => {
    const xcodeProject = modConfig.modResults;
    const projectName = modConfig.modRequest.projectName;
    // Same guard as the copy above: without it a missing name surfaces as a
    // `path.join` TypeError rather than as this plugin saying what is wrong.
    if (!projectName) {
      throw new Error("withWholeModel: the iOS project name is unknown.");
    }
    // pbxFile is deliberately constructed below rather than through
    // `addResourceFile`: that helper corrects paths against a group named
    // "Resources", which Expo's prebuilt project does not have, and the
    // correction crashes on the null group. The primitives are the same
    // calls addResourceFile makes, minus that correction; the reference
    // path is relative to $(SRCROOT) (= ios/), where the shards were
    // copied above.
    const pbxFile = require("xcode/lib/pbxFile");
    for (const name of listShards(modConfig.modRequest.projectRoot)) {
      const relativePath = path.join(projectName, name);
      const file = new pbxFile(relativePath);
      if (xcodeProject.hasFile(file.path)) {
        continue;
      }
      file.uuid = xcodeProject.generateUuid();
      file.fileRef = xcodeProject.generateUuid();
      xcodeProject.addToPbxBuildFileSection(file);
      xcodeProject.addToPbxFileReferenceSection(file);
      xcodeProject.addToPbxResourcesBuildPhase(file);
    }
    return modConfig;
  });

  return config;
};

const withWholeModel = (config) =>
  withWholeModelIos(withWholeModelGradle(withWholeModelAndroid(config)));

module.exports = createRunOncePlugin(
  withWholeModel,
  "with-whole-model",
  "1.0.0",
);
