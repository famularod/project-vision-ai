import ExpoModulesCore
import ImageIO
import PDFKit
import UIKit
import Vision

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
          var extractedPages: [ExtractedPdfPageResult] = []
          var limitations: [String] = []
          var characterCount = 0
          var ocrPageCount = 0
          var usedEmbeddedText = false
          var usedOCR = false

          for pageIndex in 0..<maximumPages {
            guard let page = document.page(at: pageIndex) else { continue }
            structuredRows.append(contentsOf: microsoftProjectRows(from: page))
            let embeddedLines = embeddedPdfLines(from: page)
            var indexedLines = embeddedLines.map {
              IndexedRecognizedLine(line: $0, source: "embedded_text")
            }
            if !embeddedLines.isEmpty { usedEmbeddedText = true }

            let embeddedCharacterCount = embeddedLines.reduce(0) { total, line in
              total + line.text.count
            }
            let shouldSupplementWithOcr = embeddedLines.count < 3 || embeddedCharacterCount < 120
            if shouldSupplementWithOcr, ocrPageCount < 40 {
              let pageBounds = page.bounds(for: .mediaBox)
              let scale = min(2_000 / max(1, pageBounds.width), 2_000 / max(1, pageBounds.height))
              let image = page.thumbnail(
                of: CGSize(width: max(1, pageBounds.width * scale), height: max(1, pageBounds.height * scale)),
                for: .mediaBox
              )
              if let cgImage = image.cgImage {
                let recognizedLines = (try? recognizeLines(in: cgImage, level: .accurate)) ?? []
                indexedLines = mergeDistinctRecognizedLines(
                  embedded: indexedLines,
                  recognized: recognizedLines.map {
                    IndexedRecognizedLine(line: $0, source: "ocr")
                  }
                )
                ocrPageCount += 1
                if !recognizedLines.isEmpty { usedOCR = true }
              }
            }

            if indexedLines.isEmpty, ocrPageCount >= 40 {
              limitations.append("OCR stopped after 40 image-only pages to protect device performance.")
            }

            let remainingCharacters = max(0, maximumCharacters - characterCount)
            let rawText = indexedLines.map { $0.line.text }.joined(separator: "\n")
            let boundedText = String(rawText.prefix(remainingCharacters))
            if !boundedText.isEmpty {
              pageTexts.append(boundedText)
              characterCount += boundedText.count
            }

            let extractedPage = ExtractedPdfPageResult()
            extractedPage.pageNumber = pageIndex + 1
            extractedPage.sheetNumber = detectedSheetNumber(
              in: indexedLines.map { $0.line },
              preferTitleBlock: true
            )
            extractedPage.title = indexedLines.first?.line.text
            extractedPage.text = boundedText.isEmpty ? nil : boundedText
            extractedPage.regions = indexedLines.enumerated().map { index, indexed in
              extractedRegion(
                from: indexed.line,
                id: "page-\(pageIndex + 1)-line-\(index + 1)",
                source: indexed.source
              )
            }
            extractedPages.append(extractedPage)
          }

          if document.pageCount > maximumPages {
            limitations.append("Only the first \(maximumPages) of \(document.pageCount) pages were indexed.")
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
          result.pages = extractedPages
          result.extractionMethod = usedOCR && usedEmbeddedText
            ? "embedded_text_and_ocr"
            : usedOCR ? "local_ocr" : usedEmbeddedText ? "embedded_text" : nil
          result.limitations = Array(Set(limitations))
          promise.resolve(result)
        }
      }
    }

    AsyncFunction("renderPdfExcerpt") {
      (
        pdfUrl: URL,
        pageNumber: Int,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        promise: Promise
      ) in
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
          do {
            let result = try renderPdfExcerpt(
              at: pdfUrl,
              pageNumber: pageNumber,
              normalizedRegion: CGRect(
                x: x,
                y: y,
                width: width,
                height: height
              )
            )
            promise.resolve(result)
          } catch {
            promise.reject(
              Exception(
                name: "DavePdfExcerptRenderingError",
                description: error.localizedDescription
              )
            )
          }
        }
      }
    }
  }
}

private func renderPdfExcerpt(
  at pdfUrl: URL,
  pageNumber: Int,
  normalizedRegion: CGRect
) throws -> RenderedPdfExcerptResult {
  guard let document = PDFDocument(url: pdfUrl) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 10,
      userInfo: [NSLocalizedDescriptionKey: "The current drawing PDF could not be opened."]
    )
  }
  let pageIndex = pageNumber - 1
  guard pageIndex >= 0, pageIndex < document.pageCount,
        let page = document.page(at: pageIndex) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 11,
      userInfo: [NSLocalizedDescriptionKey: "The cited drawing page is not present in this PDF."]
    )
  }

  let pageBounds = page.bounds(for: .mediaBox)
  guard pageBounds.width > 0, pageBounds.height > 0 else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 12,
      userInfo: [NSLocalizedDescriptionKey: "The cited drawing page has invalid dimensions."]
    )
  }

  let maximumDimension: CGFloat = 2_000
  let scale = min(
    maximumDimension / pageBounds.width,
    maximumDimension / pageBounds.height
  )
  let renderedSize = CGSize(
    width: max(1, floor(pageBounds.width * scale)),
    height: max(1, floor(pageBounds.height * scale))
  )
  let renderedPage = page.thumbnail(of: renderedSize, for: .mediaBox)
  guard let pageImage = renderedPage.cgImage else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 13,
      userInfo: [NSLocalizedDescriptionKey: "The cited drawing page could not be rendered."]
    )
  }

  // Indexed regions use normalized, top-left page coordinates. Add a small
  // margin so the report excerpt retains the nearby drawing context.
  let padding: CGFloat = 0.045
  let left = max(0, CGFloat(normalizedRegion.minX) - padding)
  let top = max(0, CGFloat(normalizedRegion.minY) - padding)
  let right = min(1, CGFloat(normalizedRegion.maxX) + padding)
  let bottom = min(1, CGFloat(normalizedRegion.maxY) + padding)
  guard right > left, bottom > top else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 14,
      userInfo: [NSLocalizedDescriptionKey: "The cited drawing area has invalid coordinates."]
    )
  }

  let pixelWidth = CGFloat(pageImage.width)
  let pixelHeight = CGFloat(pageImage.height)
  let cropRect = CGRect(
    x: floor(left * pixelWidth),
    y: floor(top * pixelHeight),
    width: ceil((right - left) * pixelWidth),
    height: ceil((bottom - top) * pixelHeight)
  ).intersection(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
  guard cropRect.width >= 2, cropRect.height >= 2,
        let excerptImage = pageImage.cropping(to: cropRect) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 15,
      userInfo: [NSLocalizedDescriptionKey: "The cited drawing area could not be cropped."]
    )
  }

  let image = UIImage(cgImage: excerptImage)
  guard let jpeg = image.jpegData(compressionQuality: 0.88) else {
    throw NSError(
      domain: "DaveTextRecognition",
      code: 16,
      userInfo: [NSLocalizedDescriptionKey: "The drawing excerpt could not be encoded."]
    )
  }

  let destination = FileManager.default.temporaryDirectory
    .appendingPathComponent("vitruvius-drawing-\(UUID().uuidString).jpg")
  try jpeg.write(to: destination, options: .atomic)

  let result = RenderedPdfExcerptResult()
  result.uri = destination.absoluteString
  result.width = excerptImage.width
  result.height = excerptImage.height
  return result
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

private func embeddedPdfLines(from page: PDFPage) -> [RecognizedLine] {
  // PDFKit selections are reported in the unrotated media-box coordinate
  // space while the excerpt renderer uses the displayed page orientation.
  // Route rotated pages through Vision so stored boxes match the rendered page.
  guard ((page.rotation % 360) + 360) % 360 == 0 else { return [] }
  let pageBounds = page.bounds(for: .mediaBox)
  guard pageBounds.width > 0, pageBounds.height > 0,
        let selection = page.selection(for: pageBounds) else { return [] }

  return selection.selectionsByLine().compactMap { lineSelection -> RecognizedLine? in
    let text = (lineSelection.string ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    let bounds = lineSelection.bounds(for: page).intersection(pageBounds)
    guard bounds.width > 0, bounds.height > 0 else { return nil }
    return RecognizedLine(
      text: text,
      confidence: 1,
      x: max(0, min(1, bounds.minX / pageBounds.width)),
      y: max(0, min(1, 1 - (bounds.maxY / pageBounds.height))),
      width: max(0, min(1, bounds.width / pageBounds.width)),
      height: max(0, min(1, bounds.height / pageBounds.height))
    )
  }
  .sorted { left, right in
    if abs(left.y - right.y) > 0.015 { return left.y < right.y }
    return left.x < right.x
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

  return (request.results ?? []).compactMap { observation -> RecognizedLine? in
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

private func mergeDistinctRecognizedLines(
  embedded: [IndexedRecognizedLine],
  recognized: [IndexedRecognizedLine]
) -> [IndexedRecognizedLine] {
  var result = embedded
  for candidate in recognized {
    let candidateText = normalizedRecognitionText(candidate.line.text)
    let duplicate = result.contains { existing in
      let existingText = normalizedRecognitionText(existing.line.text)
      let textMatches = existingText == candidateText ||
        (candidateText.count >= 8 &&
          (existingText.contains(candidateText) || candidateText.contains(existingText)))
      let spatiallyClose = abs(existing.line.x - candidate.line.x) <= 0.03 &&
        abs(existing.line.y - candidate.line.y) <= 0.03
      return textMatches && spatiallyClose
    }
    if !duplicate { result.append(candidate) }
  }
  return result.sorted { left, right in
    if abs(left.line.y - right.line.y) > 0.015 { return left.line.y < right.line.y }
    return left.line.x < right.line.x
  }
}

private func detectedSheetNumber(
  in lines: [RecognizedLine],
  preferTitleBlock: Bool
) -> String? {
  let pattern = #"\b(?:sheet(?:\s*(?:no\.?|number))?\s*[:#-]?\s*)?([A-Z]{1,3}[-.]?\d{2,4}(?:\.\d{1,2})?)\b"#
  guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
    return nil
  }
  let candidates = lines.compactMap { line -> (value: String, score: Double)? in
    let range = NSRange(line.text.startIndex..<line.text.endIndex, in: line.text)
    guard let match = expression.firstMatch(in: line.text, range: range),
          match.numberOfRanges > 1,
          let matchRange = Range(match.range(at: 1), in: line.text) else { return nil }
    let explicitLabel = line.text.range(of: #"\bsheet\b"#, options: [.regularExpression, .caseInsensitive]) != nil
    let titleBlock = preferTitleBlock && line.x >= 0.55 && line.y >= 0.55
    let score = (explicitLabel ? 4.0 : 0) + (titleBlock ? 2.0 : 0) + Double(line.x + line.y)
    return (String(line.text[matchRange]).uppercased(), score)
  }
  return candidates.max { left, right in left.score < right.score }?.value
}

private func normalizedRecognitionText(_ value: String) -> String {
  value
    .lowercased()
    .split(whereSeparator: { $0.isWhitespace })
    .joined(separator: " ")
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
  @Field var regions: [ExtractedTextRegionResult] = []
}

private struct ExtractedPdfTextResult: Record {
  @Field var text: String = ""
  @Field var format: String = "plain_text"
  @Field var pageCount: Int = 0
  @Field var pagesRead: Int = 0
  @Field var pages: [ExtractedPdfPageResult] = []
  @Field var extractionMethod: String?
  @Field var limitations: [String] = []
}

private struct ExtractedPdfPageResult: Record {
  @Field var pageNumber: Int = 0
  @Field var sheetNumber: String?
  @Field var title: String?
  @Field var text: String?
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

private struct RenderedPdfExcerptResult: Record {
  @Field var uri: String = ""
  @Field var width: Int = 0
  @Field var height: Int = 0
}

private struct RecognizedLine {
  let text: String
  let confidence: Double
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let height: CGFloat
}

private struct IndexedRecognizedLine {
  let line: RecognizedLine
  let source: String
}
