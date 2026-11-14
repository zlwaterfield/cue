"""The contact sheet of the App Store screenshots, for the README.

    python3 brand/app-store/overview.py

Lays out every image in `store/`, in upload order, three to a row, as rounded cards on
white. Needs Pillow.
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'store')

COLUMNS = 3
CARD = 330
GAP = 28
RADIUS = 22
# The corners are drawn this many times larger, then scaled down, so they're smooth.
SUPERSAMPLE = 4


def corners(size):
    w, h = size
    mask = Image.new('L', (w * SUPERSAMPLE, h * SUPERSAMPLE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, w * SUPERSAMPLE - 1, h * SUPERSAMPLE - 1), RADIUS * SUPERSAMPLE, fill=255)
    return mask.resize(size, Image.LANCZOS)


def main():
    names = sorted(n for n in os.listdir(SOURCE) if n.endswith('.png'))
    cards = []
    for name in names:
        im = Image.open(os.path.join(SOURCE, name)).convert('RGB')
        cards.append(im.resize((CARD, round(im.height * CARD / im.width)), Image.LANCZOS))
    height = max(c.height for c in cards)
    rows = -(-len(cards) // COLUMNS)
    sheet = Image.new('RGB', (GAP + COLUMNS * (CARD + GAP), GAP + rows * (height + GAP)), 'white')
    mask = corners((CARD, height))
    for i, card in enumerate(cards):
        x = GAP + (i % COLUMNS) * (CARD + GAP)
        y = GAP + (i // COLUMNS) * (height + GAP)
        sheet.paste(card, (x, y), mask)
    out = os.path.join(HERE, 'overview.png')
    sheet.save(out, optimize=True)
    print(f'overview.png  {sheet.width} × {sheet.height}, {len(cards)} images')


if __name__ == '__main__':
    main()
