// Wraps a 2x page screenshot in a macOS-style window frame for docs.
// swift scripts/frame.swift <in.png> <out.png> [light|dark]
import AppKit

let args = CommandLine.arguments
guard args.count >= 3, let content = NSImage(contentsOfFile: args[1]),
      let rep = content.representations.first else { fatalError("usage: frame.swift in.png out.png [light|dark]") }
let dark = args.count > 3 && args[3] == "dark"
let w = CGFloat(rep.pixelsWide), h = CGFloat(rep.pixelsHigh)
let pad: CGFloat = 96, radius: CGFloat = 22
let size = NSSize(width: w + pad * 2, height: h + pad * 2)

let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
let window = NSRect(x: pad, y: pad, width: w, height: h)
let shape = NSBezierPath(roundedRect: window, xRadius: radius, yRadius: radius)

let shadow = NSShadow()
shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: dark ? 0.55 : 0.22)
shadow.shadowBlurRadius = 60
shadow.shadowOffset = NSSize(width: 0, height: -24)
NSGraphicsContext.saveGraphicsState()
shadow.set()
(dark ? NSColor(calibratedWhite: 0.1, alpha: 1) : NSColor.white).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.saveGraphicsState()
shape.addClip()
content.draw(in: window)
// Traffic lights at the app's configured position (18pt, 18pt), 12pt buttons, 2x scale.
let colors = [NSColor(calibratedRed: 1, green: 0.373, blue: 0.341, alpha: 1),
              NSColor(calibratedRed: 0.996, green: 0.737, blue: 0.180, alpha: 1),
              NSColor(calibratedRed: 0.157, green: 0.784, blue: 0.251, alpha: 1)]
for (i, color) in colors.enumerated() {
  let x = window.minX + 36 + CGFloat(i) * 40
  let y = window.maxY - 36 - 24
  color.setFill()
  NSBezierPath(ovalIn: NSRect(x: x, y: y, width: 24, height: 24)).fill()
  NSColor(calibratedWhite: 0, alpha: 0.12).setStroke()
  let ring = NSBezierPath(ovalIn: NSRect(x: x + 0.5, y: y + 0.5, width: 23, height: 23))
  ring.lineWidth = 1
  ring.stroke()
}
NSGraphicsContext.restoreGraphicsState()

// Hairline edge, like a real window.
(dark ? NSColor(calibratedWhite: 1, alpha: 0.12) : NSColor(calibratedWhite: 0, alpha: 0.14)).setStroke()
shape.lineWidth = 2
shape.stroke()

NSGraphicsContext.restoreGraphicsState()
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
