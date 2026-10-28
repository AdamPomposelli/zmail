// Renders the ZMail app icon (1024×1024 PNG).
// Usage: swift apps/macos/Tools/make-icon.swift <output.png>
import AppKit
import CoreGraphics

let size = 1024
let out = CommandLine.arguments.dropFirst().first ?? "AppIcon-1024.png"

let space = CGColorSpace(name: CGColorSpace.sRGB)!
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("Cannot create bitmap context")
}

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

// macOS icon grid: 824pt rounded square centred on the 1024 canvas.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

// Soft drop shadow under the tile.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.35))
ctx.addPath(tilePath)
ctx.setFillColor(rgb(0x1a1a1d))
ctx.fillPath()
ctx.restoreGState()

// Dark vertical gradient body.
ctx.saveGState()
ctx.addPath(tilePath)
ctx.clip()
let body = CGGradient(colorsSpace: space, colors: [rgb(0x34343a), rgb(0x0d0d0f)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(body, start: CGPoint(x: 512, y: tile.maxY), end: CGPoint(x: 512, y: tile.minY), options: [])
// Faint top sheen.
let sheen = CGGradient(colorsSpace: space, colors: [rgb(0xffffff, 0.10), rgb(0xffffff, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(sheen, startCenter: CGPoint(x: 512, y: tile.maxY + 120), startRadius: 0,
                       endCenter: CGPoint(x: 512, y: tile.maxY + 120), endRadius: 620, options: [])
ctx.restoreGState()

// Hairline inner border.
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: tile.insetBy(dx: 2, dy: 2), cornerWidth: 183, cornerHeight: 183, transform: nil))
ctx.setStrokeColor(rgb(0xffffff, 0.10))
ctx.setLineWidth(4)
ctx.strokePath()
ctx.restoreGState()

// Glyph: an envelope whose top edge, diagonal and bottom edge read as a "Z".
let env = CGRect(x: 262, y: 322, width: 500, height: 380)
let stroke: CGFloat = 54
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

// Envelope sides and flap, quiet.
ctx.saveGState()
ctx.setStrokeColor(rgb(0xffffff, 0.28))
ctx.setLineWidth(stroke * 0.55)
ctx.move(to: CGPoint(x: env.minX, y: env.maxY)); ctx.addLine(to: CGPoint(x: env.minX, y: env.minY))
ctx.move(to: CGPoint(x: env.maxX, y: env.maxY)); ctx.addLine(to: CGPoint(x: env.maxX, y: env.minY))
ctx.move(to: CGPoint(x: env.minX, y: env.maxY)); ctx.addLine(to: CGPoint(x: env.midX, y: env.midY))
ctx.strokePath()
ctx.restoreGState()

// The Z, bright with a subtle vertical gradient.
let z = CGMutablePath()
z.move(to: CGPoint(x: env.minX, y: env.maxY))
z.addLine(to: CGPoint(x: env.maxX, y: env.maxY))
z.addLine(to: CGPoint(x: env.minX, y: env.minY))
z.addLine(to: CGPoint(x: env.maxX, y: env.minY))
ctx.saveGState()
ctx.addPath(z.copy(strokingWithWidth: stroke, lineCap: .round, lineJoin: .round, miterLimit: 10))
ctx.clip()
let ink = CGGradient(colorsSpace: space, colors: [rgb(0xffffff), rgb(0xd9dbe3)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(ink, start: CGPoint(x: 512, y: env.maxY + stroke), end: CGPoint(x: 512, y: env.minY - stroke), options: [])
ctx.restoreGState()

guard let image = ctx.makeImage(),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
    fatalError("Cannot encode PNG")
}
try png.write(to: URL(fileURLWithPath: out))
print(out)
