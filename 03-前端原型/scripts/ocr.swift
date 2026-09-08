import Foundation
import Vision
import PDFKit
import AppKit
import ImageIO

struct Result: Encodable { let text: String; let method: String; let pages: Int; let warnings: [String] }
enum ReaderError: Error { case invalid, limit, encrypted }
let maxCharacters = 300_000
func recognize(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let observations = request.results ?? []
    return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
func readImage(_ url: URL) throws -> Result {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = props[kCGImagePropertyPixelWidth] as? Int,
          let height = props[kCGImagePropertyPixelHeight] as? Int else { throw ReaderError.invalid }
    guard width > 0, height > 0, width <= 16000, height <= 16000, width * height <= 40_000_000 else { throw ReaderError.limit }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 3000, kCGImageSourceCreateThumbnailWithTransform: true]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw ReaderError.invalid }
    let text = try recognize(image)
    return Result(text: text, method: "apple-vision-ocr", pages: 1, warnings: ["OCR可能误识别，请核对原图。"])
}
func readPDF(_ url: URL) throws -> Result {
    guard let document = PDFDocument(url: url) else { throw ReaderError.invalid }
    if document.isLocked { throw ReaderError.encrypted }
    guard document.pageCount > 0, document.pageCount <= 60 else { throw ReaderError.limit }
    var parts: [String] = []; var usedOCR = false; var characters = 0
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else { throw ReaderError.invalid }
        var text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.count < 20 {
            usedOCR = true
            let bounds = page.bounds(for: .cropBox)
            guard bounds.width > 0, bounds.height > 0, bounds.width < 100000, bounds.height < 100000 else { throw ReaderError.limit }
            let scale = min(1800 / bounds.width, 1800 / bounds.height)
            let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
            var rect = CGRect(origin: .zero, size: image.size)
            guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { throw ReaderError.invalid }
            text = try recognize(cg)
        }
        characters += text.count
        if characters > maxCharacters { throw ReaderError.limit }
        parts.append("[第\(index + 1)页]\n\(text)")
    }
    return Result(text: characters == 0 ? "" : parts.joined(separator: "\n\n"), method: usedOCR ? "pdfkit-and-vision-ocr" : "pdfkit-text", pages: document.pageCount, warnings: usedOCR ? ["部分页面经过OCR，请逐页校对。"] : [])
}
do {
    guard CommandLine.arguments.count == 3 else { throw ReaderError.invalid }
    let mode = CommandLine.arguments[1]
    let url = URL(fileURLWithPath: CommandLine.arguments[2])
    let result = mode == "pdf" ? try readPDF(url) : try readImage(url)
    let bytes = try JSONEncoder().encode(result)
    FileHandle.standardOutput.write(bytes)
} catch {
    // No input path or document bytes are written to diagnostics.
    let code: String
    switch error { case ReaderError.limit: code = "RESOURCE_LIMIT"
    case ReaderError.encrypted: code = "ENCRYPTED_PDF"
    default: code = "READ_FAILED" }
    FileHandle.standardError.write(Data(code.utf8))
    exit(1)
}
