"""The App Store screenshots at the iPhone 6.3" size, scaled from the 6.9" set.

App Store Connect's iPhone screenshot slot for 6.1" and 6.3" displays is the one
Apple requires, and it only takes 1179 × 2556 or 1206 × 2622 — a 1320 × 2868 image
from ../store is rejected there. The two shapes differ by 0.07%, far under a pixel
of visible distortion over the height, so this scales the finished images rather
than laying them out again.

    python3 brand/app-store/store-6.3/make.py

Needs Pillow.
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, '..', 'store')

# iPhone 6.3" portrait: 402 × 874 pt at 3×. 1179 × 2556 is the 6.1", which the same
# App Store Connect slot also takes.
SIZE = (1206, 2622)

# How far the scale is from uniform. Anything a person could see is a mistake.
SKEW_LIMIT = 0.002


def main():
    for name in sorted(os.listdir(SOURCE)):
        if not name.endswith('.png'):
            continue
        im = Image.open(os.path.join(SOURCE, name)).convert('RGB')
        skew = abs((SIZE[0] / im.width) / (SIZE[1] / im.height) - 1)
        if skew > SKEW_LIMIT:
            raise SystemExit(f'{name}: {im.width} × {im.height} would stretch {skew:.2%} '
                             f'to reach {SIZE[0]} × {SIZE[1]}; lay it out again instead')
        out = os.path.join(HERE, name)
        # RGB, so no alpha channel — App Store Connect rejects one.
        im.resize(SIZE, Image.LANCZOS).save(out, optimize=True)
        print(f'{name}  {SIZE[0]} × {SIZE[1]}  {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main()
