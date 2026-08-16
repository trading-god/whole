// macOS-side Apple Vision OCR, producing the same `blocks.json` fixture the
// device capture screen exports — so a screenshot dropped into `samples/<slug>/`
// can become a regression fixture without booting a device.
//
// This is a deliberate line-by-line port of the iOS path, NOT an approximation.
// The app's `expo-mlkit-ocr` build sets `EXPO_MLKIT_OCR_DISABLE_MLKIT=1` (see
// the Podfile), so iOS already runs Apple Vision's `VNRecognizeTextRequest` —
// the same framework and model family this script calls. To keep the fixtures
// interchangeable, four things mirror the module's Vision branch exactly:
//
//   1. Request config: `.accurate`, language correction on, and the
//      `["zh-Hans", "en-US"]` languages the repo patches in
//      (patches/expo-mlkit-ocr@0.2.7.patch) so Chinese labels survive.
//   2. Observation order: top-to-bottom, then left-to-right.
//   3. Word-level granularity: each line is split on whitespace and each word
//      gets its own box via `boundingBox(for:)`, falling back to the line's box.
//      This matches `flattenBlocks` in ocr-engine.ts, which takes the finest
//      granularity the engine offers (elements over lines over blocks).
//   4. Coordinates: Vision is bottom-left origin, the parser is top-left, so y
//      is flipped as `1 - y - height`. Values stay normalized 0..1 — the device
//      path denormalizes to pixels and `normalizeOcrResult` divides them right
//      back, so emitting normalized values directly is equivalent and lossless.
//
// Usage: swift recognize-text.swift <image-path>   → fixture JSON on stdout
// Driven by `src/vision.ts` (`pnpm eval:ocr:vision`).
import CoreGraphics
import Foundation
import ImageIO
import Vision

struct Box: Encodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct Block: Encodable {
  let text: String
  let box: Box
}

struct Fixture: Encodable {
  let source: String
  let blocks: [Block]
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(("recognize-text: " + message + "\n").utf8))
  exit(1)
}

// Vision boxes are normalized with a bottom-left origin; the parser's contract
// (`@whole/ocr`'s contract/block.ts) is normalized with a top-left origin.
func toBox(_ rect: CGRect) -> Box {
  Box(
    x: Double(rect.origin.x),
    y: Double(1.0 - rect.origin.y - rect.size.height),
    width: Double(rect.size.width),
    height: Double(rect.size.height)
  )
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  fail("usage: recognize-text.swift <image-path>")
}
let imageURL = URL(fileURLWithPath: arguments[1])

guard let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
  let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
  fail("cannot read image: \(imageURL.path)")
}

// Honour the file's EXIF orientation the way the iOS module honours
// `UIImage.imageOrientation` — a rotated screenshot would otherwise yield boxes
// in the wrong axis.
let imageProperties =
  CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any]
let rawOrientation = imageProperties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
do {
  try handler.perform([request])
} catch {
  fail("text recognition failed: \(error.localizedDescription)")
}

// Sorted top-to-bottom then left-to-right (Vision's y grows upward, so a larger
// minY is higher on screen) to keep the fixture's block order stable.
let observations = (request.results ?? [])
  .sorted { a, b in
    if a.boundingBox.minY != b.boundingBox.minY {
      return a.boundingBox.minY > b.boundingBox.minY
    }
    return a.boundingBox.minX < b.boundingBox.minX
  }

var blocks: [Block] = []
for observation in observations {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let lineText = candidate.string
  let lineRect = observation.boundingBox

  let words = lineText.split(whereSeparator: { $0.isWhitespace }).map(String.init)
  // A line with no whitespace-delimited words (CJK runs still yield one word)
  // falls back to emitting the line itself, mirroring the module's
  // line-over-elements fallback.
  if words.isEmpty {
    blocks.append(Block(text: lineText, box: toBox(lineRect)))
    continue
  }

  var searchStart = lineText.startIndex
  for word in words {
    guard let range = lineText.range(of: word, range: searchStart..<lineText.endIndex)
    else { continue }
    searchStart = range.upperBound
    // Vision can't always map a substring back to a box; the module falls back
    // to the whole line's box, so this does too.
    let wordRect = (try? candidate.boundingBox(for: range))?.boundingBox ?? lineRect
    blocks.append(Block(text: word, box: toBox(wordRect)))
  }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
// `Fixture`'s declaration order (source, then blocks) is preserved by
// JSONEncoder, so the output stays readable without sorting keys alphabetically.
guard let data = try? encoder.encode(Fixture(source: "macos-vision", blocks: blocks)),
  let json = String(data: data, encoding: .utf8)
else {
  fail("failed to encode fixture JSON")
}
print(json)
