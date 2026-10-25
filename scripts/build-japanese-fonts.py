"""
Builds the three Japanese faces the Japanese PDFs embed (issue #117), from
Morisawa's BIZ UD fonts as Google Fonts publishes them under the SIL Open Font
License 1.1, which allows embedding, redistribution and modified versions; it
names no Reserved Font Name, and every face's OS/2 fsType is 0 (installable).

    python3 -m venv .venv && .venv/bin/pip install fonttools==4.67.0
    .venv/bin/python scripts/build-japanese-fonts.py <dir holding the three source .ttf files>

The sources, by SHA-256 (google/fonts `ofl/bizudpgothic` and `ofl/bizudmincho`,
built from googlefonts/morisawa-biz-ud-gothic 18934af and
googlefonts/morisawa-biz-ud-mincho c30a622):

    258d7156c165f2ff774b6efee637c22c3b950de0d8a10e501137061bc8085d01  BIZUDPGothic-Regular.ttf
    30eba52fc837e8b62c97d4b82e6706583149fb7294e3712dd71a655eaea80a90  BIZUDPGothic-Bold.ttf
    468ee6d9b149ca144809e03841bf18740ecf014e055a00da6ecaf1aaf4165af2  BIZUDMincho-Regular.ttf

Whole, the three are 15 MB, and 10 MB compressed, which with the rest of the
Worker would pass the 10 MB a paid Worker may be. So each is cut down, the same
way, to what a Japanese application document can need:

- the characters Windows' Japanese code page (CP932) can write — JIS X 0208
  with the NEC and IBM extensions, so 髙 and 﨑 are kept — and the Latin,
  Latin-1, Latin Extended-A and -B letters, general punctuation, the symbol
  blocks CP932's own symbols come from, and half-width kana. A character
  outside it is refused by name when the PDF is built, as the résumé refuses
  one Carlito lacks; the Word file still prints it.
- no hinting: a PDF reader scales outlines, and the instructions are a third of
  the file.
- no GSUB, GPOS or vertical metrics: the documents are horizontal and set one
  glyph per character, as the résumé's PDF is (no ligatures, no alternates).
  Without GSUB a character's glyph is its `cmap` entry and nothing else, which
  is what lets `src/render/font-subset.ts` know every glyph a PDF draws.

The output names are unchanged: the licence reserves none.
"""

import sys
from pathlib import Path

from fontTools import subset

FACES = ["BIZUDPGothic-Regular", "BIZUDPGothic-Bold", "BIZUDMincho-Regular"]
OUT = Path(__file__).resolve().parent.parent / "templates" / "fonts"


def repertoire():
    """CP932's characters, then the Latin and punctuation blocks a name or a technology can use."""
    codes = set()
    for lead in range(0x81, 0x100):
        for trail in range(0x40, 0xFD):
            try:
                text = bytes([lead, trail]).decode("cp932")
            except UnicodeDecodeError:
                continue
            if len(text) == 1:
                codes.add(ord(text))
    codes.update(range(0x20, 0x7F))  # ASCII
    codes.update(range(0xA0, 0x250))  # Latin-1, Latin Extended-A and -B
    codes.update(range(0x2000, 0x2070))  # General Punctuation
    # Symbols CP932 decodes to a different code point than Japanese text often
    # carries (〜 U+301C beside ～ U+FF5E, − U+2212 beside － U+FF0D), and the
    # blocks its own symbols come from, whole: ℃ №, arrows, ①, ■ ★.
    codes.update(range(0x2100, 0x2150))  # Letterlike Symbols
    codes.update(range(0x2190, 0x2300))  # Arrows, Mathematical Operators
    codes.update(range(0x2460, 0x2700))  # Enclosed Alphanumerics, box drawing, shapes, symbols
    codes.update(range(0x3000, 0x3040))  # CJK Symbols and Punctuation
    codes.update(range(0xFF61, 0xFFA0))  # half-width kana
    return sorted(codes)


def main(source: Path):
    options = subset.Options()
    options.hinting = False
    options.layout_features = []
    options.drop_tables += ["DSIG", "GSUB", "GPOS", "vhea", "vmtx", "meta"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    codes = repertoire()
    for face in FACES:
        font = subset.load_font(str(source / f"{face}.ttf"), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=codes)
        subsetter.subset(font)
        subset.save_font(font, str(OUT / f"{face}.ttf"), options)
        print(face, (OUT / f"{face}.ttf").stat().st_size)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
