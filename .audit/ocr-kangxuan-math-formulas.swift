import AppKit
import Foundation
import Vision

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let files = try FileManager.default.contentsOfDirectory(at: input, includingPropertiesForKeys: nil)
    .filter { !$0.hasDirectoryPath }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
var result: [String: [String]] = [:]

for file in files {
    guard let source = NSImage(contentsOf: file) else {
        result[file.deletingPathExtension().lastPathComponent] = []
        continue
    }
    let scale: CGFloat = 12
    let image = NSImage(size: NSSize(width: max(240, source.size.width * scale), height: max(160, source.size.height * scale)))
    image.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: image.size).fill()
    source.draw(in: NSRect(
        x: 12,
        y: 12,
        width: source.size.width * scale,
        height: source.size.height * scale
    ), from: NSRect(origin: .zero, size: source.size), operation: .sourceOver, fraction: 1,
       respectFlipped: true, hints: [.interpolation: NSImageInterpolation.none])
    image.unlockFocus()
    guard let data = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: data),
          let cgImage = bitmap.cgImage else {
        result[file.deletingPathExtension().lastPathComponent] = []
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US", "zh-Hant"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: cgImage).perform([request])
    let lines = (request.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
    result[file.deletingPathExtension().lastPathComponent] = lines
}

let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
