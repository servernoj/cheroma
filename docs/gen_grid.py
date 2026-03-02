from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas

OUTPUT = "docs/grid.pdf"

GRID_COLS, GRID_ROWS = 4, 4
CELL_MM = 40
SUB_MM = 10
FINE_MM = 2

THICK = 0.7 * mm
MEDIUM = 0.4 * mm
FINE = 0.25  # pt – thinnest practical hairline

page_w, page_h = letter
total_w = GRID_COLS * CELL_MM * mm
total_h = GRID_ROWS * CELL_MM * mm
x0 = (page_w - total_w) / 2
y0 = (page_h - total_h) / 2

c = Canvas(OUTPUT, pagesize=letter)

# Fine 2mm grid
c.setStrokeColorRGB(0.55, 0.55, 0.55)
c.setLineWidth(FINE)
steps_x = int(GRID_COLS * CELL_MM / FINE_MM) + 1
steps_y = int(GRID_ROWS * CELL_MM / FINE_MM) + 1
for i in range(steps_x):
    x = x0 + i * FINE_MM * mm
    c.line(x, y0, x, y0 + total_h)
for j in range(steps_y):
    y = y0 + j * FINE_MM * mm
    c.line(x0, y, x0 + total_w, y)

# Medium 10mm grid
c.setStrokeColorRGB(0.25, 0.25, 0.25)
c.setLineWidth(MEDIUM)
steps_x = int(GRID_COLS * CELL_MM / SUB_MM) + 1
steps_y = int(GRID_ROWS * CELL_MM / SUB_MM) + 1
for i in range(steps_x):
    x = x0 + i * SUB_MM * mm
    c.line(x, y0, x, y0 + total_h)
for j in range(steps_y):
    y = y0 + j * SUB_MM * mm
    c.line(x0, y, x0 + total_w, y)

# Thick 40mm grid
c.setStrokeColorRGB(0, 0, 0)
c.setLineWidth(THICK)
for i in range(GRID_COLS + 1):
    x = x0 + i * CELL_MM * mm
    c.line(x, y0, x, y0 + total_h)
for j in range(GRID_ROWS + 1):
    y = y0 + j * CELL_MM * mm
    c.line(x0, y, x0 + total_w, y)

DOT_R = 1 * mm
c.setFillColorRGB(0, 0, 0)
for col in range(GRID_COLS):
    for row in range(GRID_ROWS):
        cx = x0 + (col + 0.5) * CELL_MM * mm
        cy = y0 + (row + 0.5) * CELL_MM * mm
        c.circle(cx, cy, DOT_R, stroke=0, fill=1)

c.save()
print(f"Saved {OUTPUT}")
