"""
Writes the home page's iPhone shot, light and dark (Pillow).

    python3 apps/desktop/scripts/phone-shots.py

The light one is the App Store screen `docs/app-store/screens/08-mac.png`, which
holds the same day as the Mac window beside it on the page, at half size.

There is no dark screenshot of that day, and the screens can only be captured on a
Mac, so the dark one is derived from the light one. The iPhone app's screens are
grey from end to end, so going light to dark is one tone curve per channel, and the
curve is measured rather than guessed: `01-today.png` and `07-dark.png` share their
status bar, month label and weekday letters pixel for pixel, so pairing those rows
gives the app's own light-to-dark mapping. It lands on the brand tokens exactly
(#1C1C1E → #ECECEF, #6C6C72 → #9D9DA4, #8E8E94 → #76767D), and on the rows it was
not fitted on it matches the real dark screenshot within 8/255 for 94% of pixels —
the rest being the two days' different content, not the curve.

Capture a real dark screenshot of the day and this can go.
"""
import os

import numpy as np
from PIL import Image

# The repository root, three folders up: this script reads the App Store screens and
# writes into the site.
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SCREENS = os.path.join(ROOT, 'docs', 'app-store', 'screens')
OUT = os.path.join(ROOT, 'site', 'images')

SOURCE = '08-mac.png'
SCALE = 0.5
QUALITY = 86

# The rows `01-today.png` and `07-dark.png` share: the status bar and the month
# label. The weekday letters below them are shared too, but the selected day's
# circle sits among them and differs, so they are left out.
SHARED = [(40, 130, 0, 1320), (230, 300, 40, 560)]


def tone_curve(light, dark, channel):
    """The app's light-to-dark mapping for one channel, as a 256-entry table."""
    samples = {}
    for r0, r1, c0, c1 in SHARED:
        for a, b in zip(light[r0:r1, c0:c1, channel].ravel(), dark[r0:r1, c0:c1, channel].ravel()):
            samples.setdefault(int(a), []).append(int(b))

    points = []
    for value in sorted(samples):
        seen = sorted(samples[value])
        n = len(seen)
        # Too few samples to trust, or the two screens disagree about this grey.
        if n < 20 or seen[9 * n // 10] - seen[n // 10] > 12:
            continue
        points.append([value, float(seen[n // 2]), float(n)])

    # Darker ink can only map to lighter ink, so pool any pair that says otherwise
    # (pool adjacent violators), weighted by how many pixels each was measured from.
    i = 0
    while i < len(points) - 1:
        if points[i][1] < points[i + 1][1]:
            _, out_b, n_b = points.pop(i + 1)
            value, out_a, n_a = points[i]
            points[i] = [value, (out_a * n_a + out_b * n_b) / (n_a + n_b), n_a + n_b]
            i = max(i - 1, 0)
        else:
            i += 1

    curve = np.interp(np.arange(256), [p[0] for p in points], [p[1] for p in points])
    return np.clip(np.round(curve), 0, 255).astype(np.uint8)


def read(name):
    return np.asarray(Image.open(os.path.join(SCREENS, name)).convert('RGB'), dtype=np.uint8)


def write(pixels, name):
    image = Image.fromarray(pixels)
    size = (round(image.width * SCALE), round(image.height * SCALE))
    image = image.resize(size, Image.LANCZOS)
    path = os.path.join(OUT, name)
    image.save(path, 'WEBP', quality=QUALITY, method=6)
    print(f'{os.path.relpath(path, ROOT)}  {size[0]} × {size[1]}  {os.path.getsize(path) // 1024} KB')


light = read(SOURCE)
curves = [tone_curve(read('01-today.png'), read('07-dark.png'), channel) for channel in range(3)]
dark = np.stack([curves[channel][light[:, :, channel]] for channel in range(3)], axis=2)

write(light, 'phone-light.webp')
write(dark, 'phone-dark.webp')
