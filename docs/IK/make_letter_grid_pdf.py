#!/usr/bin/env python3
"""
Generate a US-Letter PDF grid with a centered area:
- major blocks: 20 mm (thicker lines)
- subgrid: 5 mm (thin lines)

Requested layout:
- 10 × 13 major blocks (i.e. 200 mm × 260 mm) centered on the page
- allow splitting into 4 sections of 5 × 6.5 blocks via center divider lines

No external dependencies (pure stdlib). Produces vector line PDF.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple


MM_PER_INCH = 25.4
PT_PER_INCH = 72.0
PT_PER_MM = PT_PER_INCH / MM_PER_INCH


def mm_to_pt(mm: float) -> float:
    return mm * PT_PER_MM


LETTER_W_PT = 8.5 * PT_PER_INCH   # 612
LETTER_H_PT = 11.0 * PT_PER_INCH  # 792


@dataclass
class PdfObj:
    num: int
    data: bytes


class SimplePdf:
    def __init__(self) -> None:
        self._objs: List[PdfObj] = []

    def add_obj(self, data: bytes) -> int:
        num = len(self._objs) + 1
        self._objs.append(PdfObj(num=num, data=data))
        return num

    def build(self) -> bytes:
        out = bytearray()
        out.extend(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")

        offsets: List[int] = [0]  # xref requires obj 0
        for obj in self._objs:
            offsets.append(len(out))
            out.extend(f"{obj.num} 0 obj\n".encode("ascii"))
            out.extend(obj.data)
            if not obj.data.endswith(b"\n"):
                out.extend(b"\n")
            out.extend(b"endobj\n")

        xref_start = len(out)
        out.extend(b"xref\n")
        out.extend(f"0 {len(self._objs)+1}\n".encode("ascii"))
        out.extend(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            out.extend(f"{off:010d} 00000 n \n".encode("ascii"))

        # trailer
        out.extend(b"trailer\n")
        out.extend(b"<<\n")
        out.extend(f"/Size {len(self._objs)+1}\n".encode("ascii"))
        out.extend(b"/Root 1 0 R\n")
        out.extend(b">>\n")
        out.extend(b"startxref\n")
        out.extend(f"{xref_start}\n".encode("ascii"))
        out.extend(b"%%EOF\n")
        return bytes(out)


def make_grid_content(
    page_w_pt: float,
    page_h_pt: float,
    *,
    origin_x_pt: float,
    origin_y_pt: float,
    grid_w_mm: float,
    grid_h_mm: float,
    minor_mm: float = 5.0,
    major_mm: float = 20.0,
    major_offset_x_mm: float = 0.0,
    major_offset_y_mm: float = 0.0,
    thin_w_pt: float = 0.25,
    thick_w_pt: float = 0.85,
    split_w_pt: float = 1.25,
    thin_gray: float = 0.80,
    thick_gray: float = 0.55,
    split_gray: float = 0.35,
) -> bytes:
    minor_pt = mm_to_pt(minor_mm)
    major_pt = mm_to_pt(major_mm)
    grid_w_pt = mm_to_pt(grid_w_mm)
    grid_h_pt = mm_to_pt(grid_h_mm)
    major_off_x_pt = mm_to_pt(major_offset_x_mm)
    major_off_y_pt = mm_to_pt(major_offset_y_mm)

    # Decide which lines are thick: multiples of major step.
    def is_major(pos_pt: float, off_pt: float) -> bool:
        # Use rounding to avoid floating mismatch at page end.
        if major_pt == 0:
            return False
        k = round((pos_pt - off_pt) / major_pt)
        return abs((pos_pt - off_pt) - k * major_pt) < 1e-6

    lines_thin: List[Tuple[float, float, float, float]] = []
    lines_thick: List[Tuple[float, float, float, float]] = []
    lines_split: List[Tuple[float, float, float, float]] = []

    # Vertical lines
    x_local = 0.0
    while x_local <= grid_w_pt + 1e-6:
        x = origin_x_pt + x_local
        line = (x, origin_y_pt, x, origin_y_pt + grid_h_pt)
        (lines_thick if is_major(x_local, major_off_x_pt) else lines_thin).append(line)
        x_local += minor_pt

    # Horizontal lines
    y_local = 0.0
    while y_local <= grid_h_pt + 1e-6:
        y = origin_y_pt + y_local
        line = (origin_x_pt, y, origin_x_pt + grid_w_pt, y)
        (lines_thick if is_major(y_local, major_off_y_pt) else lines_thin).append(line)
        y_local += minor_pt

    # Split lines to enable 4 quadrants: 5 × 6.5 major blocks
    # - vertical split at 5 blocks = 100 mm
    # - horizontal split at 6.5 blocks = 130 mm (half a 20mm block)
    split_x_local = mm_to_pt(100.0)
    split_y_local = mm_to_pt(130.0)
    lines_split.append(
        (origin_x_pt + split_x_local, origin_y_pt, origin_x_pt + split_x_local, origin_y_pt + grid_h_pt)
    )
    lines_split.append(
        (origin_x_pt, origin_y_pt + split_y_local, origin_x_pt + grid_w_pt, origin_y_pt + split_y_local)
    )

    def fmt(n: float) -> str:
        return f"{n:.3f}"

    parts: List[str] = []
    parts.append("q")  # save graphics state

    # Thin lines
    parts.append(f"{fmt(thin_w_pt)} w")
    parts.append(f"{fmt(thin_gray)} {fmt(thin_gray)} {fmt(thin_gray)} RG")
    for (x0, y0, x1, y1) in lines_thin:
        parts.append(f"{fmt(x0)} {fmt(y0)} m {fmt(x1)} {fmt(y1)} l S")

    # Thick lines
    parts.append(f"{fmt(thick_w_pt)} w")
    parts.append(f"{fmt(thick_gray)} {fmt(thick_gray)} {fmt(thick_gray)} RG")
    for (x0, y0, x1, y1) in lines_thick:
        parts.append(f"{fmt(x0)} {fmt(y0)} m {fmt(x1)} {fmt(y1)} l S")

    # Split (quadrant) lines
    parts.append(f"{fmt(split_w_pt)} w")
    parts.append(f"{fmt(split_gray)} {fmt(split_gray)} {fmt(split_gray)} RG")
    for (x0, y0, x1, y1) in lines_split:
        parts.append(f"{fmt(x0)} {fmt(y0)} m {fmt(x1)} {fmt(y1)} l S")

    parts.append("Q")  # restore graphics state
    parts.append("")   # final newline
    return ("\n".join(parts)).encode("ascii")


def main() -> None:
    pdf = SimplePdf()

    # Target grid area: 10×13 blocks of 20mm => 200mm × 260mm.
    grid_w_mm = 200.0
    grid_h_mm = 260.0
    grid_w_pt = mm_to_pt(grid_w_mm)
    grid_h_pt = mm_to_pt(grid_h_mm)

    # Center the grid area on the page.
    origin_x_pt = (LETTER_W_PT - grid_w_pt) / 2.0
    origin_y_pt = (LETTER_H_PT - grid_h_pt) / 2.0

    content = make_grid_content(
        LETTER_W_PT,
        LETTER_H_PT,
        origin_x_pt=origin_x_pt,
        origin_y_pt=origin_y_pt,
        grid_w_mm=grid_w_mm,
        grid_h_mm=grid_h_mm,
        minor_mm=5.0,
        major_mm=20.0,
        # Offset major horizontal grid by 10mm so that the midline at 130mm
        # falls on a major line, leaving half-blocks at the top and bottom edges.
        major_offset_x_mm=0.0,
        major_offset_y_mm=10.0,
    )

    contents = b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream\n"

    # Add placeholder catalog (will refer to pages obj 2)
    pdf.add_obj(b"<< /Type /Catalog /Pages 2 0 R >>\n")

    # Pages object (one page)
    pdf.add_obj(b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n")

    # Page objects (no resources needed for simple strokes)
    page_common = f"/MediaBox [0 0 {LETTER_W_PT:.3f} {LETTER_H_PT:.3f}]".encode("ascii")
    page1 = b"<< /Type /Page /Parent 2 0 R " + page_common + b" /Contents 4 0 R >>\n"
    pdf.add_obj(page1)

    # Contents objects
    pdf.add_obj(contents)

    out_path = "/Users/servernoj/Projects/2025/cheroma/docs/IK/grid_letter_centered_10x13_20mm_blocks_5mm_subgrid.pdf"
    with open(out_path, "wb") as f:
        f.write(pdf.build())

    print(out_path)


if __name__ == "__main__":
    main()

