import Foundation
import ImageIO
import Vision

/// Apple Vision 回傳給 Node.js 的單一文字區塊。
struct Recognition: Codable {
    /// Vision 對候選文字的信心值。
    let confidence: Float
    /// 區塊中辨識到的文字。
    let text: String
    /// 區塊左側的正規化座標。
    let x: Double
    /// 區塊上緣的正規化座標。
    let y: Double
}

let imageData = FileHandle.standardInput.readDataToEndOfFile()
guard !imageData.isEmpty,
      let source = CGImageSourceCreateWithData(imageData as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write(Data("INVALID_IMAGE\n".utf8))
    exit(65)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .fast
request.recognitionLanguages = ["zh-Hant", "en-US"]
request.usesLanguageCorrection = false

do {
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let results = (request.results ?? []).compactMap { observation -> Recognition? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return Recognition(
            confidence: candidate.confidence,
            text: candidate.string,
            x: observation.boundingBox.minX,
            y: observation.boundingBox.maxY
        )
    }.sorted { left, right in
        if abs(left.y - right.y) > 0.04 { return left.y > right.y }
        return left.x < right.x
    }
    let output = try JSONEncoder().encode(results)
    FileHandle.standardOutput.write(output)
}
catch {
    FileHandle.standardError.write(Data("VISION_REQUEST_FAILED\n".utf8))
    exit(70)
}
