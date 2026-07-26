import ExpoModulesCore
import ImageIO
import PDFKit
import Vision

public final class DaveTextRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DaveTextRecognition")

    AsyncFunction("recognizeText") { (imageUrl: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
          do {
            let preparedImage = try downsampleImage(at: imageUrl, maximumDimension: 1_600)
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .fast
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]

            let handler = VNImageRequestHandler(
              cgImage: preparedImage,
              orientation: .up,
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

    AsyncFunction("extractTextFromPdf") { (pdfUrl: URL, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
          guard let document = PDFDocument(url: pdfUrl) else {
            promise.reject(
              Exception(
                name: "DavePdfTextExtractionError",
                description: "The selected PDF could not be opened."
              )
            )
            return
          }

          let maximumPages = min(document.pageCount, 100)
          let maximumCharacters = 500_000
          var structuredRows: [String] = []
          var pageTexts: [String] = []
          var characterCount = 0

          for pageIndex in 0..<maximumPages {
            guard let page = document.page(at: pageIndex) else { continue }
            structuredRows.append(contentsOf: microsoftProjectRows(from: page))

            guard let pageText = page.string else { continue }
            let cleaned = pageText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty else { continue }

            let remainingCharacters = maximumCharacters - characterCount
            guard remainingCharacters > 0 else { break }
            let boundedText = String(cleaned.prefix(remainingCharacters))
            pageTexts.append(boundedText)
            characterCount += boundedText.count
          }

          let result = ExtractedPdfTextResult()
          if structuredRows.isEmpty {
            result.text = pageTexts.joined(separator: "\n")
            result.format = "plain_text"
          } else {
            let header = "ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tActual Start\tActual Finish\tPredecessors"
            result.text = ([header] + structuredRows).joined(separator: "\n")
            result.format = "microsoft_project_tsv"
          }
          result.pageCount = document.pageCount
          result.pagesRead = maximumPages
          promise.resolve(result)
        }
      }
    }
  }
}

private struct PdfTextCell {
  let x: CGFloat
  let text: String
}

private func microsoftProjectRows(from page: PDFPage) -> [String] {
  guard let selection = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
  var groupedRows: [Int: [PdfTextCell]] = [:]

  for lineSelection in selection.selectionsByLine() {
    let text = (lineSelection.string ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { continue }

    let bounds = lineSelection.bounds(for: page)
    guard bounds.minX < 770 else { continue }
    let rowKey = Int(round(bounds.midY))
    groupedRows[rowKey, default: []].append(PdfTextCell(x: bounds.minX, text: text))
  }

  return groupedRows.keys.sorted(by: >).compactMap { rowKey in
    microsoftProjectRow(from: groupedRows[rowKey] ?? [])
  }
}

private func microsoftProjectRow(from unsortedCells: [PdfTextCell]) -> String? {
  let cells = unsortedCells.sorted { $0.x < $1.x }
  let leftCells = cells.filter { $0.x < 370 }
  let leftText = leftCells.map(\.text).joined(separator: " ")
  let leftParts = leftText.split(separator: " ", maxSplits: 1).map(String.init)

  guard
    leftParts.count == 2,
    Int(leftParts[0]) != nil,
    !leftParts[1].isEmpty
  else {
    return nil
  }

  let duration = pdfCellText(cells, from: 370, to: 430)
  guard duration.range(of: #"^\d+\s+days?$"#, options: .regularExpression) != nil else {
    return nil
  }

  let taskX = leftCells.count > 1 ? leftCells[1].x : leftCells[0].x
  let indent = taskX < 70 ? 0 : max(0, Int(round((taskX - 71) / 8)))
  let values = [
    leftParts[0],
    sanitizedPdfCell(leftParts[1]),
    String(indent),
    duration,
    pdfCellText(cells, from: 430, to: 490),
    pdfCellText(cells, from: 490, to: 565),
    pdfCellText(cells, from: 565, to: 590),
    pdfCellText(cells, from: 590, to: 650),
    pdfCellText(cells, from: 650, to: 715),
    pdfCellText(cells, from: 715, to: 770),
  ]

  return values.map(sanitizedPdfCell).joined(separator: "\t")
}

private func pdfCellText(
  _ cells: [PdfTextCell],
  from minimumX: CGFloat,
  to maximumX: CGFloat
) -> String {
  cells
    .filter { $0.x >= minimumX && $0.x < maximumX }
    .map(\.text)
    .joined(separator: " ")
}

private func sanitizedPdfCell(_ value: String) -> String {
  value
    .replacingOccurrences(of: "\t", with: " ")
    .replacingOccurrences(of: "\n", with: " ")
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func downsampleImage(
  at imageUrl: URL,
  maximumDimension: Int
) throws -> CGImage {
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

private struct RecognizedTextResult: Record {
  @Field var text: String = ""
  @Field var lines: [String] = []
  @Field var averageConfidence: Double = 0
}

private struct ExtractedPdfTextResult: Record {
  @Field var text: String = ""
  @Field var format: String = "plain_text"
  @Field var pageCount: Int = 0
  @Field var pagesRead: Int = 0
}

private struct RecognizedLine {
  let text: String
  let confidence: Double
  let x: CGFloat
  let y: CGFloat
}
