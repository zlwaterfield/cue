"""
Wraps a 2x page screenshot in a macOS-style window frame for docs (Pillow).

    python3 scripts/frame.py <in.png> <out.png> [light|dark]

The same drawing as scripts/frame.swift, for machines without Swift:
`pnpm screenshots` uses that one on a Mac and this one everywhere else. Keep the
two in step: 96 px of padding, a 22 px corner, a soft shadow below, the traffic
lights where the app puts them, and a hairline edge.
"""
import sys

from PIL import Image, ImageDraw, ImageFilter

PAD, RADIUS, SS = 96, 22, 4


def rounded(size, box, radius, fill, outline=None, width=0):
    """A rounded rectangle on a transparent layer, drawn large and scaled down so its edge is smooth."""
    layer = Image.new('RGBA', (size[0] * SS, size[1] * SS), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([v * SS for v in box], radius * SS, fill=fill, outline=outline, width=width * SS)
    return layer.resize(size, Image.LANCZOS)


def frame(source, target, dark):
    content = Image.open(source).convert('RGBA')
    w, h = content.size
    size = (w + PAD * 2, h + PAD * 2)
    window = (PAD, PAD, PAD + w, PAD + h)
    out = Image.new('RGBA', size, (0, 0, 0, 0))

    # The shadow: the window's shape, 24 px down, blurred.
    alpha = int(255 * (0.55 if dark else 0.22))
    shadow = rounded(size, (PAD, PAD + 24, PAD + w, PAD + h + 24), RADIUS, (0, 0, 0, alpha))
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(30)))

    # The page, clipped to the window's corners.
    mask = rounded(size, window, RADIUS, (255, 255, 255, 255)).getchannel('A')
    page = Image.new('RGBA', size, (0, 0, 0, 0))
    page.paste(content, (PAD, PAD))
    lights = Image.new('RGBA', (size[0] * SS, size[1] * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(lights)
    # Traffic lights at the app's configured position (18 pt, 18 pt), 12 pt buttons, 2x scale.
    for i, color in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        x, y = PAD + 36 + i * 40, PAD + 36
        draw.ellipse([x * SS, y * SS, (x + 24) * SS, (y + 24) * SS], fill=color + (255,), outline=(0, 0, 0, 31), width=SS)
    page.alpha_composite(lights.resize(size, Image.LANCZOS))
    page.putalpha(Image.composite(page.getchannel('A'), Image.new('L', size, 0), mask))
    out.alpha_composite(page)

    # Hairline edge, like a real window.
    edge = (255, 255, 255, 31) if dark else (0, 0, 0, 36)
    out.alpha_composite(rounded(size, window, RADIUS, None, outline=edge, width=2))
    out.save(target)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit('usage: frame.py in.png out.png [light|dark]')
    frame(sys.argv[1], sys.argv[2], len(sys.argv) > 3 and sys.argv[3] == 'dark')
