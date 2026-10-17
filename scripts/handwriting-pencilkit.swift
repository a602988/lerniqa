import AppKit
import Foundation
import PencilKit

/// 瀏覽器傳入的一次完整數位筆跡。
struct InkRequest: Decodable {
    /// 畫布高度。
    let height: Double
    /// 依落筆順序排列的線條。
    let strokes: [InkStroke]
    /// 畫布寬度。
    let width: Double
}

/// 從落筆到抬筆之間的一條線。
struct InkStroke: Decodable {
    /// 依採樣時間排列的指標座標。
    let points: [InkPoint]
}

/// 指標在畫布上的單次採樣。
struct InkPoint: Decodable {
    /// 裝置提供的壓力值。
    let force: Double?
    /// 相對於本次書寫開始的毫秒數。
    let t: Double
    /// 畫布水平座標。
    let x: Double
    /// 畫布垂直座標。
    let y: Double
}

/// 回傳給 Node.js 的辨識結果。
struct Recognition: Encodable {
    /// 作業系統是否支援所需語言與辨識 API。
    let supported: Bool
    /// PencilKit 辨識出的文字。
    let text: String?
}

/// 將網頁筆跡轉成 PencilKit drawing 後執行裝置端辨識。
@main
struct HandwritingPencilKit {
    /// 讀取標準輸入、辨識筆跡並輸出 JSON。
    static func main() async {
        guard #available(macOS 27.0, *) else {
            write(Recognition(supported: false, text: nil))
            return
        }
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let input = try JSONDecoder().decode(InkRequest.self, from: data)
            let ink = PKInk(.pen, color: .black)
            let strokes = input.strokes.compactMap { stroke -> PKStroke? in
                guard let first = stroke.points.first else { return nil }
                let points = stroke.points.map { point in
                    PKStrokePoint(
                        location: CGPoint(x: point.x, y: point.y),
                        timeOffset: max(0, (point.t - first.t) / 1_000),
                        size: CGSize(width: 4, height: 4),
                        opacity: 1,
                        force: point.force ?? 1,
                        azimuth: 0,
                        altitude: .pi / 2
                    )
                }
                let creationDate = Date(timeIntervalSince1970: first.t / 1_000)
                let path = PKStrokePath(controlPoints: points, creationDate: creationDate)
                return PKStroke(ink: ink, path: path)
            }
            let language = Locale.Language(identifier: "zh-Hant")
            guard PKStrokeRecognizer.supportedLanguages.contains(language) else {
                write(Recognition(supported: false, text: nil))
                return
            }
            let recognizer = PKStrokeRecognizer(preferredLanguages: [language])
            await recognizer.updateDrawing(PKDrawing(strokes: strokes))
            let text = await recognizer.recognizedText()?.trimmingCharacters(in: .whitespacesAndNewlines)
            write(Recognition(supported: true, text: text?.isEmpty == false ? text : nil))
        }
        catch {
            write(Recognition(supported: true, text: nil))
        }
    }

    /// 將固定格式結果寫到標準輸出。
    ///
    /// - Parameter recognition: 可序列化的辨識結果。
    static func write(_ recognition: Recognition) {
        guard let data = try? JSONEncoder().encode(recognition) else { return }
        FileHandle.standardOutput.write(data)
    }
}
