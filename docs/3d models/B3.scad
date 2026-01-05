// B3 bracket interface (visual approval model)
//
// Geometry described by user:
// - Outer interface rectangle: 50mm x 20mm
// - Center hole: Ø6mm at (0,0)
// - 8x M3 holes located at the corners of THREE squares placed side-by-side
//   along the long symmetry axis (X axis), with the middle square centered at origin.
//
// Interpretation (yields 8 holes as stated):
// - The 3 squares share edges (forming a 1x3 strip), so their corner set is a 4x2 grid.
// - Each square has diagonal = 14mm, so side = 14/sqrt(2).
// - Hole coordinates are at x = (-1.5a, -0.5a, +0.5a, +1.5a) and y = (±a/2), where a=side.
//
// Coordinate system:
// - Origin at plate center
// - X = long axis (50mm)
// - Y = short axis (20mm)

// ----------------------------
// Parameters
// ----------------------------
plate_x = 50;            // mm
plate_y = 20;            // mm
plate_thickness = 3;     // mm (visualization thickness)

center_hole_d = 6;       // mm
m3_hole_d = 3.2;         // mm (clearance)

square_diag = 14;        // mm (diagonal of each square)

$fn = 96;

module hole(d, h) {
    cylinder(d=d, h=h, center=true);
}

module plate() {
    linear_extrude(height=plate_thickness)
        square([plate_x, plate_y], center=true);
}

// ----------------------------
// Model
// ----------------------------
difference() {
    plate();

    h = plate_thickness + 2;

    // Center hole
    translate([0, 0, plate_thickness/2])
        hole(center_hole_d, h);

    // 8x M3 holes from 3 edge-sharing squares
    a = square_diag / sqrt(2); // side length

    xs = [-1.5*a, -0.5*a, 0.5*a, 1.5*a];
    ys = [-0.5*a, 0.5*a];

    for (x = xs, y = ys)
        translate([x, y, plate_thickness/2])
            hole(m3_hole_d, h);
}
