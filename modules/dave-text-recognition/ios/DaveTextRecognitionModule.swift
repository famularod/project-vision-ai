import ExpoModulesCore
import Foundation
import ImageIO
import UIKit
import Vision

private let maximumRecognizedRegions = 5_000
private let pdfFileSignature = Data([0x25, 0x50, 0x44, 0x46, 0x2D])

public final class DaveTextRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DaveTextRecognition")

    AsyncFunction("recognizeText") { (imageUrl: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
          do {
            let preparedImage = try downsampleImage(at: imageUrl, maximumDimension: 1_600)
            let recognized = try recognizeLines(in: preparedImage, level: .fast)

            let lines = recognized.map(\.text)
            let averageConfidence = recognized.isEmpty
              ? 0
              : recognized.map(\.confidence).reduce(0, +) / Double(recognized.count)

            let result = RecognizedTextResult()
            result.text = lines.joined(separator: "\n")
            result.lines = lines
            result.averageConfidence = averageConfidence
            result.regions = recognized.enumerated().map { index, line in
              extractedRegion(from: line, id: "image-line-\(index + 1)", source: "ocr")
            }
            promise.resolve(result)
          } catch {
            promise.reject(
              Exception(
                name: "DaveTextRecognitionError",
                description: error.localizedDescription
              )
            )
          }
        }
      }
    }

    // Untrusted PDFs are prepared by the killable hosted worker. PDFKit has no
    // repository-enforceable complexity deadline or cancellation boundary, so
    // neither PDF text extraction nor PDF proof rendering is registered in the
    // app process. Bounded image OCR remains available on device.
  }
}

private func recognizeLines(
  in image: CGImage,
  level: VNRequestTextRecognitionLevel
) throws -> [RecognizedLine] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = level
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-US"]
  let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
  try handler.perform([request])

  return (request.results ?? []).prefix(maximumRecognizedRegions).compactMap { observation -> RecognizedLine? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    let bounds = observation.boundingBox
    return RecognizedLine(
      text: text,
      confidence: Double(candidate.confidence),
      x: bounds.minX,
      y: 1 - bounds.maxY,
      width: bounds.width,
      height: bounds.height
    )
  }
  .sorted { left, right in
    if abs(left.y - right.y) > 0.015 { return left.y < right.y }
    return left.x < right.x
  }
}

private func extractedRegion(
  from line: RecognizedLine,
  id: String,
  source: String
) -> ExtractedTextRegionResult {
  let region = ExtractedTextRegionResult()
  region.id = id
  region.label = line.text
  region.text = line.text
  region.areaNames = []
  region.x = Double(line.x)
  region.y = Double(line.y)
  region.width = Double(line.width)
  region.height = Double(line.height)
  region.confidence = line.confidence
  region.source = source
  return region
}

private func downsampleImage(
  at imageUrl: URL,
  maximumDimension: Int
) throws -> CGImage {
  try rejectNativePDFArtifact(at: imageUrl)
  guard let source = CGImageSourceCreateWithURL(imageUrl as CFURL, nil) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "The selected screenshot could not be opened."]
    )
  }

  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maximumDimension,
    kCGImageSourceShouldCacheImmediately: false,
  ]

  guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: "The selected screenshot could not be prepared for recognition."]
    )
  }

  return image
}

private func rejectNativePDFArtifact(at imageUrl: URL) throws {
  let extensionClaimsPDF = imageUrl.pathExtension.lowercased() == "pdf"
  let file = try FileHandle(forReadingFrom: imageUrl)
  defer { try? file.close() }
  let prefix = try file.read(upToCount: 1_024) ?? Data()
  if extensionClaimsPDF || prefix.range(of: pdfFileSignature) != nil {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 3,
      userInfo: [
        NSLocalizedDescriptionKey:
          "PDF preparation requires the protected hosted ECOS worker."
      ]
    )
  }
}

private struct RecognizedTextResult: Record {
  @Field var text: String = ""
  @Field var lines: [String] = []
  @Field var averageConfidence: Double = 0
  @Field var regions: [ExtractedTextRegionResult] = []
}

private struct ExtractedTextRegionResult: Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var text: String = ""
  @Field var areaNames: [String] = []
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var confidence: Double = 0
  @Field var source: String = "ocr"
}

private struct RecognizedLine {
  let text: String
  let confidence: Double
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let height: CGFloat
}
