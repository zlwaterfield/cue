"""The ninth iPhone App Store image: Notes, with scratch and the starred notes.

    python3 brand/app-store/notes.py

Writes `screens/09-notes.png`, the plain screen, and `store/09-notes.png`, the image to
upload (1320 × 2868). Then run `store-6.3/make.py` for the 6.3" size and `overview.py`
for the contact sheet.

The screen is laid out in HTML by `page.py`, which says how and what it takes from the
other screens. The store image is the frame of `store/01-today.png`: its paper, phone,
corners and status bar, with this headline and screen in place of that one's.

Needs Pillow, Playwright and a Chrome or Chromium, like `creative/make.py`.
"""
import os

from PIL import Image

import page
from page import HERE

NAME = '09-notes.png'
HEADLINE = 'Not everything<br>belongs to a day.'

# The page: a starred note, open, with scratch and one more note beside it.
NOTES = ['Scratch', 'Books to read', 'Gift ideas']
OPEN = 'Books to read'
# (depth, kind, text). The first line is the note's name, set as its title.
LINES = [
    (0, 'text', 'Books to read'),
    (0, 'done', 'The Remains of the Day'),
    (0, 'done', 'Piranesi'),
    (0, 'todo', 'Seeing Like a State'),
    (0, 'todo', 'A Swim in a Pond in the Rain'),
    (1, 'bullet', 'Jonas says start with the Chekhov chapter'),
    (0, 'todo', 'Middlemarch'),
    (1, 'bullet', 'The Penguin edition, with the notes'),
    (0, 'todo', 'The Dispossessed'),
    (0, 'todo', 'Braiding Sweetgrass'),
    (0, 'bullet', 'For Lisbon'),
    (1, 'todo', 'The Book of Disquiet'),
    (1, 'done', 'Something short for the train'),
]

# The iPhone 17 Pro Max: 440 × 956 pt.
WIDTH, HEIGHT = 440, 956

# The frame, measured from the other eight: a 1080 px screen whose top edge is at 783 px
# and whose corners end 152 px below it, and the paper above it where the headline goes.
FRAME = 'store/01-today.png'
SCREEN_LEFT, SCREEN_TOP, SCREEN_WIDTH = 120, 783, 1080
CORNERS_END = 936
HEADLINE_ROWS = (140, 660)


def screen(browser):
    p = page.Page(WIDTH, HEIGHT)
    y = p.iphone_status()
    y = p.header(y, 'Notes', today_pill=True, notes_open=True)
    y = p.notes_strip(y, NOTES, OPEN)
    y = p.note_head(y, '★ Starred', ['Share', 'Delete'])
    p.lines(y, LINES, title_first=True)
    return page.render_page(browser, p)


def store(browser, shot):
    image = Image.open(os.path.join(HERE, FRAME)).convert('RGB')
    # The headline and its symbol, over plain paper.
    top, bottom = HEADLINE_ROWS
    symbol = lambda height, stroke: page.note_symbol(height, stroke, page.GRAPHITE)
    head = page.render(browser, page.headline_html(image.width, bottom, HEADLINE, symbol), (image.width, bottom), 1)
    image.paste(head.crop((0, top, image.width, bottom)), (0, top))
    # The screen, below the corners and the status bar, which are the frame's own.
    height = round(shot.height * SCREEN_WIDTH / shot.width)
    scaled = shot.resize((SCREEN_WIDTH, height), Image.LANCZOS)
    visible = scaled.crop((0, CORNERS_END - SCREEN_TOP, SCREEN_WIDTH, min(height, image.height - SCREEN_TOP)))
    image.paste(visible, (SCREEN_LEFT, CORNERS_END))
    return image


def main():
    with page.chrome() as browser:
        shot = screen(browser)
        image = store(browser, shot)
    for folder, im in (('screens', shot), ('store', image)):
        out = os.path.join(HERE, folder, NAME)
        # RGB, so no alpha channel; App Store Connect rejects one.
        im.save(out, optimize=True)
        print(f'{folder}/{NAME}  {im.width} × {im.height}')


if __name__ == '__main__':
    main()
