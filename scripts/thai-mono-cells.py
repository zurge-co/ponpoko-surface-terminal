"""Give every Thai glyph exactly one monospace cell.

A terminal draws on a fixed grid: every character owns one cell as wide as the
Latin mono font's advance (600/1000 em for SF Mono and Menlo). A Thai face is
proportional instead — เ is 295 units, ญ is 849 — so in the grid the narrow
characters leave a hole after them and the wide ones overflow their cell, and
each run gets padded by a different amount. That is what makes Thai text look
unevenly spaced in a terminal.

SARA AM (ำ) is left exactly as the face draws it: it carries a spacing vowel
next to the nikhahit, so it needs two cells while xterm gives a Thai cluster
one, and squeezing it into one cell would distort every word that uses it.

This script rewrites the Thai block of a proportional face into a monospaced
one: every glyph advances exactly one cell, so the grid never has to pad a Thai
run. A glyph keeps the position it has inside its own advance — a vowel stays
next to the consonant before it — except the five leading vowels (เ แ โ ใ ไ),
which belong to the consonant after them and are pushed to the right edge of
their cell. Only glyphs whose ink is wider than a cell are scaled down, and
their GPOS anchors travel with them so tone marks stay on their base. Combining
marks keep their zero advance.

Usage: python3 scripts/thai-mono-cells.py <source.woff2> <target.woff2>
"""

import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

CELL_UNITS = 600
EDGE_UNITS = 20
THAI_BLOCK = range(0x0E01, 0x0E5C)
LEADING_VOWELS = range(0x0E40, 0x0E45)
SARA_AM = 0x0E33


def ink_bounds(glyph_set, name):
    pen = BoundsPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.bounds


def move_anchor(anchor, scale, offset):
    if anchor is None:
        return
    anchor.XCoordinate = round(scale * anchor.XCoordinate + offset)


def move_base_anchors(gpos, name, scale, offset):
    if gpos is None or gpos.LookupList is None:
        return
    for lookup in gpos.LookupList.Lookup:
        for subtable in lookup.SubTable:
            bases = getattr(subtable, "BaseCoverage", None)
            records = getattr(subtable, "BaseArray", None)
            if bases is not None and records is not None:
                if name in bases.glyphs:
                    index = bases.glyphs.index(name)
                    for anchor in records.BaseRecord[index].BaseAnchor:
                        move_anchor(anchor, scale, offset)
            marks = getattr(subtable, "Mark2Coverage", None)
            records = getattr(subtable, "Mark2Array", None)
            if marks is not None and records is not None:
                if name in marks.glyphs:
                    index = marks.glyphs.index(name)
                    for anchor in records.Mark2Record[index].Mark2Anchor:
                        move_anchor(anchor, scale, offset)


def transform(glyph, glyphs, scale, offset):
    for index in range(len(glyph.coordinates)):
        x, y = glyph.coordinates[index]
        glyph.coordinates[index] = (scale * x + offset, y)
    glyph.recalcBounds(glyphs)


def cell_transform(x_min, x_max, right_aligned):
    width = x_max - x_min
    if right_aligned:
        return 1.0, (CELL_UNITS - EDGE_UNITS) - x_max
    if width > CELL_UNITS - 2 * EDGE_UNITS:
        scale = (CELL_UNITS - 2 * EDGE_UNITS) / width
        return scale, CELL_UNITS / 2 - scale * (x_min + x_max) / 2
    return 1.0, 0


def main(source, target):
    font = TTFont(source)
    glyphs = font["glyf"]
    metrics = font["hmtx"]
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    gpos = font["GPOS"].table if "GPOS" in font else None

    mono = 0
    scaled = 0
    for codepoint in THAI_BLOCK:
        name = cmap.get(codepoint)
        if name is None:
            continue
        advance, _ = metrics[name]
        if advance == 0 or codepoint == SARA_AM:
            continue
        bounds = ink_bounds(glyph_set, name)
        if bounds is None:
            continue
        scale, offset = cell_transform(bounds[0], bounds[2], codepoint in LEADING_VOWELS)
        glyph = glyphs[name]
        transform(glyph, glyphs, scale, offset)
        move_base_anchors(gpos, name, scale, offset)
        metrics[name] = (CELL_UNITS, round(scale * glyph.xMin))
        mono += 1
        if scale < 1:
            scaled += 1

    font.flavor = "woff2"
    font.save(target)
    print(f"{target}: {mono} Thai glyphs at {CELL_UNITS} units, {scaled} scaled to fit the cell")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
