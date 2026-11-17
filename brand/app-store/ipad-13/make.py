"""The iPad App Store screenshot, for the 13" display slot: 2064 × 2752, portrait.

    python3 brand/app-store/ipad-13/make.py

Writes `screens/01-today.png`, the plain screen (the iPad Pro 13", 1032 × 1376 pt at
2×), and `01-today.png`, the image to upload. App Store Connect's iPad 12.9"/13" slot
takes 2064 × 2752 or 2048 × 2732, portrait or landscape.

The iPhone app runs on the iPad as it is, across the whole width; there is no capture of
it there, so the screen is laid out in HTML by `../page.py` from the app's own styles,
with the same day as the iPhone's first screenshot and the links it shows in 05-links.
The headline and the paper are the iPhone images', scaled up; the iPad is drawn in the
same graphite.

Needs Pillow, Playwright and a Chrome or Chromium, like `../creative/make.py`.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import page  # noqa: E402

NAME = '01-today.png'
HEADLINE = 'Every day<br>is a page.'

# The iPad Pro 13": 1032 × 1376 pt at 2×, the size App Store Connect takes.
WIDTH, HEIGHT, IPAD_SCALE = 1032, 1376, 2
CANVAS = (WIDTH * IPAD_SCALE, HEIGHT * IPAD_SCALE)

# Wednesday, October 28, 2026, as on the iPhone's first screenshot.
MONTH = 'October 2026'
WEEK = [('M', '26'), ('T', '27'), ('W', '28'), ('T', '29'), ('F', '30'), ('S', '31'), ('S', '1')]
TODAY, MARKED = '28', {'26', '27', '29', '30', '31'}
LINES = [
    (0, 'text', 'Slow morning. Coffee first, then the studio.'),
    (0, 'done', 'Send the invoice to Harbor &amp; Co.'),
    (0, 'done', 'Water the fig'),
    (0, 'todo', 'Review Priya’s Q4 plan'),
    (1, 'bullet', 'Tighten the roadmap section'),
    (1, 'bullet', 'Cut the dashboard idea'),
    (0, 'bullet', 'Thanksgiving'),
    (1, 'done', 'Book the train'),
    (1, 'todo', 'Call Mom about the menu'),
    (0, 'bullet', 'Groceries'),
    (1, 'done', 'Oat milk'),
    (1, 'todo', 'Lemons'),
    (1, 'todo', 'Sourdough'),
    (0, 'text', 'Dinner with Sam at 7:30. Bring back the book.'),
    (0, 'bullet', 'Links'),
    (1, 'link', ('Weeknight lemon pasta with crispy capers', 'Small Kitchen')),
    (1, 'link', ('Notes on calm software', 'Field Guide')),
    (1, 'link', ('Week 9 of marathon training: the long run finally felt easy. Slow miles work.', '@mayaruns')),
    (1, 'link', ('River Loop, 14 km · Easy, mostly flat', 'Trailmaps')),
    (1, 'link', ('Lisbon by tram: the 28 line, stop by stop', 'Atlas of Small Places')),
]


def today(width, height, status):
    """The day, on a screen `width` × `height` points; `status` is 'iphone' or 'ipad'."""
    p = page.Page(width, height)
    y = p.iphone_status() if status == 'iphone' else p.ipad_status()
    y = p.header(y, MONTH)
    y = p.week(y, WEEK, TODAY, TODAY, MARKED)
    y = p.day_head(y, 'Today', 'Wednesday, October 28')
    y = p.loose_ends(y, '3 open from earlier days')
    p.lines(y, LINES)
    return p


# The frame, from the iPhone images scaled up: they are 1320 px wide with a 1080 px screen,
# a 27 px bezel and a soft shadow, the headline above. The iPad's bezel is wider and its
# corners rounder against its width, as the device's are.
HEAD_SCALE = 1.4
SCREEN_WIDTH = 1700
BEZEL = 0.04
SCREEN_RADIUS = 28 / WIDTH
DEVICE_TOP = round(756 * HEAD_SCALE)
# The iPhone images' shadow, 45 px down and 106 px of blur at 14%, sized with the device.
SHADOW = (45, 106, 0.14)


def frame_html(screen_uri, screen_height):
    w, h = CANVAS
    k = SCREEN_WIDTH / 1080
    bezel = round(SCREEN_WIDTH * BEZEL)
    radius = SCREEN_WIDTH * SCREEN_RADIUS
    left = (w - SCREEN_WIDTH) / 2 - bezel
    # The paper is flat behind the headline and darkens a little behind the device.
    flat, dark = DEVICE_TOP - 136 * HEAD_SCALE, DEVICE_TOP + 750 * HEAD_SCALE
    dy, blur, alpha = SHADOW
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body {{ margin: 0; width: {w}px; height: {h}px; overflow: hidden; }}
body {{ background: linear-gradient(180deg, {page.PAPER} {flat}px, {page.PAPER_BOTTOM} {dark}px); }}
.device {{ position: absolute; left: {left}px; top: {DEVICE_TOP}px; padding: {bezel}px;
  background: {page.GRAPHITE}; border-radius: {radius + bezel}px;
  box-shadow: 0 {dy * k}px {blur * k}px rgba(0, 0, 0, {alpha}); }}
.device img {{ display: block; width: {SCREEN_WIDTH}px; height: {screen_height}px; border-radius: {radius}px; }}
</style></head><body><div class="device"><img src="{screen_uri}" alt=""></div></body></html>'''


def main():
    with page.chrome() as browser:
        shot = page.render_page(browser, today(WIDTH, HEIGHT, 'ipad'))
        plain = shot.resize(CANVAS, Image.LANCZOS)
        height = round(shot.height * SCREEN_WIDTH / shot.width)
        scaled = shot.resize((SCREEN_WIDTH, height), Image.LANCZOS)
        image = page.render(browser, frame_html(page.png_uri(scaled), height), CANVAS, 1)
        # The headline and the lockup, over the flat paper above the device's shadow.
        rows = round(DEVICE_TOP - 140 * HEAD_SCALE)
        head = page.render(browser, page.headline_html(CANVAS[0], rows, HEADLINE, 'lockup', HEAD_SCALE),
                           (CANVAS[0], rows), 1)
        image.paste(head, (0, 0))
    for name, im in (('screens/' + NAME, plain), (NAME, image)):
        # RGB, so no alpha channel; App Store Connect rejects one.
        im.convert('RGB').save(os.path.join(HERE, name), optimize=True)
        print(f'ipad-13/{name}  {im.width} × {im.height}')


if __name__ == '__main__':
    main()
