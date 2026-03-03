import Foundation
import AppKit
import PDFKit

func die(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
if args.count < 3 || args.count > 4 {
    die("Usage: swift tools/render-pdf-pages.swift <input.pdf> <output_dir> [scale]")
}

let inputURL = URL(fileURLWithPath: args[1])
let outputDirURL = URL(fileURLWithPath: args[2], isDirectory: true)
let scale: CGFloat

if args.count == 4 {
    guard let parsed = Double(args[3]), parsed > 0 else {
        die("scale must be a positive number")
    }
    scale = CGFloat(parsed)
} else {
    scale = 2.0
}

guard let document = PDFDocument(url: inputURL) else {
    die("Cannot open PDF: \(inputURL.path)")
}

try? FileManager.default.createDirectory(at: outputDirURL, withIntermediateDirectories: true)

for pageIndex in 0..<document.pageCount {
    guard let page = document.page(at: pageIndex) else {
        continue
    }

    let bounds = page.bounds(for: .mediaBox)
    let width = max(1, Int(floor(bounds.width * scale)))
    let height = max(1, Int(floor(bounds.height * scale)))
    let targetSize = NSSize(width: CGFloat(width), height: CGFloat(height))

    let image = NSImage(size: targetSize)
    image.lockFocus()

    guard let ctx = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        die("Cannot acquire CGContext")
    }

    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fill(CGRect(origin: .zero, size: CGSize(width: targetSize.width, height: targetSize.height)))

    ctx.saveGState()
    ctx.translateBy(x: 0, y: targetSize.height)
    ctx.scaleBy(x: scale, y: -scale)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()

    image.unlockFocus()

    guard
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
    else {
        die("Failed converting page \(pageIndex + 1) to PNG")
    }

    let outName = String(format: "page_%04d.png", pageIndex + 1)
    let outURL = outputDirURL.appendingPathComponent(outName)
    do {
        try png.write(to: outURL)
    } catch {
        die("Failed writing \(outURL.path): \(error)")
    }
}

print("rendered_pages=\(document.pageCount)")
