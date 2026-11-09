import sys
# Разрезать длинный скрин на полосы рядом: python3 tile.py out.png in.png [высота полосы]
from PIL import Image
# tile.py out.png in.png [seg_h] — разрезать длинный скрин на полосы и поставить рядом
out, src = sys.argv[1], sys.argv[2]; sh = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
im = Image.open(src).convert('RGB'); w, h = im.size
segs = [im.crop((0, y, w, min(h, y + sh))) for y in range(0, h, sh)]
gap = 12; W = len(segs) * w + (len(segs) - 1) * gap
c = Image.new('RGB', (W, sh), (255, 0, 255))
for i, s in enumerate(segs): c.paste(s, (i * (w + gap), 0))
c.save(out)
print(out, c.size)
