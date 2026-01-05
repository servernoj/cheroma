// B2 bracket interface (visual approval model)
//
// Geometry described by user:
// - Outer interface rectangle: 40mm x 20mm
// - Center hole: Ø6mm at (0,0)
// - 4x M3 holes on lines of symmetry, spaced 7mm from center:
//   (±7, 0) and (0, ±7)
//
// Coordinate system:
// - Origin at plate center
// - X = long axis (40mm)
// - Y = short axis (20mm)

// ----------------------------
// Parameters
// ----------------------------
plate_x = 40;            // mm
plate_y = 20;            // mm
plate_thickness = 3;     // mm (visualization thickness)

center_hole_d = 6;       // mm
m3_hole_d = 3.2;         // mm (clearance)

hole_offset = 7;         // mm from center along symmetry axes

$fn = 96;

module hole(d, h) {
    cylinder(d=d, h=h, center=true);
}

module plate() {
    linear_extrude(height=plate_thickness)
        square([plate_x, plate_y], center=true);
}

difference() {
    plate();

    h = plate_thickness + 2;

    // Center hole
    translate([0, 0, plate_thickness/2])
        hole(center_hole_d, h);

    // 4x M3 holes at (±7,0), (0,±7)
    for (sx = [-1, 1])
        translate([sx*hole_offset, 0, plate_thickness/2])
            hole(m3_hole_d, h);

    for (sy = [-1, 1])
        translate([0, sy*hole_offset, plate_thickness/2])
            hole(m3_hole_d, h);
}
