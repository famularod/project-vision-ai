import ExpoModulesCore
import ImageIO
import UIKit
import Vision

public final class DaveTextRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DaveTextRecognition")

    AsyncFunction("recognizeText") { (imageUrl: URL) -> RecognizedTextResult in
      let path = imageUrl.isFileURL ? imageUrl.path : imageUrl.absoluteString

      guard
        let image = UIImage(contentsOfFile: path),
        let cgImage = image.cgImage
      else {
        throw NSError(
          domain: "DaveTextRecognition",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "The selected screenshot could not be opened."]
        )
      }

      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      request.recognitionLanguages = ["en-US"]

      let handler = VNImageRequestHandler(
        cgImage: cgImage,
        orientation: image.cgImageOrientation,
        options: [:]
      )
      try handler.perform([request])

      let observations = request.results ?? []
      let recognized = observations.compactMap { observation -> RecognizedLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        return RecognizedLine(
          text: text,
          confidence: Double(candidate.confidence),
          x: observation.boundingBox.minX,
          y: observation.boundingBox.maxY
        )
      }
      .sorted { left, right in
        if abs(left.y - right.y) > 0.015 { return left.y > right.y }
        return left.x < right.x
      }

      let lines = recognized.map(\.text)
      let averageConfidence = recognized.isEmpty
        ? 0
        : recognized.map(\.confidence).reduce(0, +) / Double(recognized.count)

      let result = RecognizedTextResult()
      result.text = lines.joined(separator: "\n")
      result.lines = lines
      result.averageConfidence = averageConfidence
      return result
    }
  }
}

private struct RecognizedTextResult: Record {
  @Field var text: String = ""
  @Field var lines: [String] = []
  @Field var averageConfidence: Double = 0
}

private struct RecognizedLine {
  let text: String
  let confidence: Double
  let x: CGFloat
  let y: CGFloat
}

private extension UIImage {
  var cgImageOrientation: CGImagePropertyOrientation {
    switch imageOrientation {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
