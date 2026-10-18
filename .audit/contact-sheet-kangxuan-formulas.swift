import AppKit
import Foundation

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let files = try FileManager.default.contentsOfDirectory(at: input, includingPropertiesForKeys: nil)
    .filter { !$0.hasDirectoryPath }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
let columns = 4
let rows = 8
let cellWidth = 500
let cellHeight = 170
let scale: CGFloat = 4
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

for page in 0..<Int(ceil(Double(files.count) / Double(columns * rows))) {
    let pageFiles = Array(files.dropFirst(page * columns * rows).prefix(columns * rows))
    let image = NSImage(size: NSSize(width: columns * cellWidth, height: rows * cellHeight))
    image.lockFocus()
    NSColor.white.setFill()
    NSRect(origin: .zero, size: image.size).fill()
    for (index, file) in pageFiles.enumerated() {
        let column = index % columns
        let row = index / columns
        let x = CGFloat(column * cellWidth)
        let y = CGFloat((rows - row - 1) * cellHeight)
        let hash = file.deletingPathExtension().lastPathComponent
        (hash.prefix(12) as NSString).draw(at: NSPoint(x: x + 10, y: y + 140), withAttributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 18, weight: .regular),
            .foregroundColor: NSColor.black,
        ])
        if let formula = NSImage(contentsOf: file) {
            let width = min(CGFloat(cellWidth - 20), formula.size.width * scale)
            let height = min(CGFloat(120), formula.size.height * scale)
            formula.draw(in: NSRect(x: x + 10, y: y + 10, width: width, height: height),
                         from: NSRect(origin: .zero, size: formula.size),
                         operation: .sourceOver,
                         fraction: 1,
                         respectFlipped: true,
                         hints: [.interpolation: NSImageInterpolation.none])
        }
    }
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else { continue }
    try png.write(to: output.appendingPathComponent(String(format: "page-%02d.png", page + 1)))
}
