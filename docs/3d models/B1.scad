// B1 bracket interface (visual approval model)
//
// Geometry described by user:
// - Outer interface rectangle: 56mm x 21mm
// - Center hole: Ø9mm at (0,0)
// - M3 holes:
//   - 8 holes at corners AND edge-centers of an inscribed aligned rectangle 42mm x 14mm
//     (i.e. corners ±21,±7 plus edge centers ±21,0 and 0,±7)
//   - 2 additional M3 holes on the long symmetry axis (X axis) at x=±7mm

// ----------------------------
// Parameters
// ----------------------------
plate_x = 56;            // mm (long dimension)
plate_y = 21;            // mm (short dimension)
plate_thickness = 3;     // mm (visualization thickness)

center_hole_d = 9;       // mm
m3_hole_d = 3.2;         // mm (clearance)

// Inscribed rectangle for the 8-hole pattern
inscribed_x = 42;        // mm (along X)
inscribed_y = 14;        // mm (along Y)

$fn = 96;

// ----------------------------
// Helpers
// ----------------------------
module hole(d, h) {
    cylinder(d=d, h=h, center=true);
}

module plate() {
    linear_extrude(height=plate_thickness)
        square([plate_x, plate_y], center=true);
}

module b1_holes() {
    h = plate_thickness + 2;

    // Center Ø9 hole
    translate([0, 0, plate_thickness/2])
        hole(center_hole_d, h);

    // 8 M3 holes: corners + edge-centers of inscribed rectangle
    ix = inscribed_x/2;
    iy = inscribed_y/2;

    // corners
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx*ix, sy*iy, plate_thickness/2])
            hole(m3_hole_d, h);

    // edge centers
    for (sx = [-1, 1])
        translate([sx*ix, 0, plate_thickness/2])
            hole(m3_hole_d, h);

    for (sy = [-1, 1])
        translate([0, sy*iy, plate_thickness/2])
            hole(m3_hole_d, h);

    // 2 additional M3 holes on long symmetry axis at x=±7
    for (sx = [-1, 1])
        translate([sx*7, 0, plate_thickness/2])
            hole(m3_hole_d, h);
}

// ----------------------------
// Model
// ----------------------------
difference() {
    plate();
    b1_holes();
}
