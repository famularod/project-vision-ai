from pathlib import Path
from PIL import Image

directory = Path(__file__).parent / 'pdfs' / 'architectural-page-13'
source = Image.open(directory / 'full-9000.jpg')
width, height = source.size
tiles = [
    (0, 0, 1 / 3, 1 / 2),
    (1 / 3, 0, 1 / 3, 1 / 2),
    (2 / 3, 0, 1 / 3, 1 / 2),
    (0, 1 / 2, 1 / 3, 1 / 2),
    (1 / 3, 1 / 2, 1 / 3, 1 / 2),
    (2 / 3, 1 / 2, 1 / 3, 1 / 2),
]
for index, (x, y, tile_width, tile_height) in enumerate(tiles):
    left = round(x * width)
    top = round(y * height)
    right = round((x + tile_width) * width)
    bottom = round((y + tile_height) * height)
    source.crop((left, top, right, bottom)).save(
        directory / f'tile-{index}.jpg',
        quality=82,
        optimize=True,
    )
