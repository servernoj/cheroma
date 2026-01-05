// P1d part (derivative of P1c): B1 - P1d - B2
//
// Changes vs P1c:
// - Increase BOTH bracket interface plates thickness to 5mm (was 3mm).
// - Keep connector webs + tapered solid bulkheads + simple M3 through-holes.
//
// Coordinate system:
// - Origin at center of B1 interface plane
// - Z axis goes from B1 side to B2 side

// ----------------------------
// Global parameters
// ----------------------------
body_length = 200;       // mm (distance between the two interface planes, excluding bosses)

plate_thickness = 5;     // mm (bracket interface plate thickness)

// Through holes
m3_hole_d = 3.2;         // mm (clearance)

// Bosses (locating features)
B1_boss_d = 9;           // mm
B2_boss_d = 6;           // mm
boss_height = 3;         // mm (protrusion into bracket hole)

// Connector webs
web_thickness = 5;       // mm (plate thickness, along X)
web_x = 14;              // mm (center X position of each web)
B1_interface_width = 21; // mm (Y width of B1 interface)
B2_interface_width = 20; // mm (Y width of B2 interface)
web_overlap = 0.6;       // mm (overlap into interface plates for a solid joint)

// Stabilizing plates (bulkheads)
bulkhead_count = 3;
bulkhead_thickness = 5;  // mm (along Z)
// Bulkhead footprint (XY). Sized to tie both side webs together.
bulkhead_x = 2*(web_x + web_thickness/2);  // mm

$fn = 96;

// ----------------------------
// Helpers
// ----------------------------
module cyl_hole(d, h) {
    cylinder(d=d, h=h, center=true);
}

module plate_rect(x, y, z0, thk) {
    translate([0, 0, z0])
        linear_extrude(height=thk)
            square([x, y], center=true);
}

module trapezoid_web_at_x(xc, z_inner_B1, z_inner_B2) {
    // Builds a trapezoidal web (in Y-Z), thickened in X, using hull between two thin slices.
    eps = 1; // mm slice thickness for hull

    z1 = z_inner_B1 - web_overlap;
    z2 = z_inner_B2 + web_overlap;

    hull() {
        translate([xc, 0, z1])
            cube([web_thickness, B1_interface_width, eps], center=true);
        translate([xc, 0, z2])
            cube([web_thickness, B2_interface_width, eps], center=true);
    }
}

module connector_webs() {
    z_inner_B1 = plate_thickness;
    z_inner_B2 = body_length - plate_thickness;

    trapezoid_web_at_x(+web_x, z_inner_B1, z_inner_B2);
    trapezoid_web_at_x(-web_x, z_inner_B1, z_inner_B2);
}

function clamp01(t) = (t < 0) ? 0 : (t > 1) ? 1 : t;
function lerp(a, b, t) = a + (b - a) * t;
function web_width_at_z(z) =
    // Linear taper from B1_interface_width at z=plate_thickness to B2_interface_width at z=body_length-plate_thickness
    lerp(B1_interface_width, B2_interface_width,
         clamp01((z - plate_thickness) / ((body_length - plate_thickness) - plate_thickness)));

module bulkheads() {
    // Evenly spaced within the connector region (between inner faces)
    z0 = plate_thickness;
    z1 = body_length - plate_thickness;
    span = z1 - z0;

    for (i = [1:bulkhead_count]) {
        zc = z0 + span * (i/(bulkhead_count+1));

        // Solid trapezoidal plate matching the web taper at this Z
        y_low = web_width_at_z(zc - bulkhead_thickness/2);
        y_high = web_width_at_z(zc + bulkhead_thickness/2);

        hull() {
            translate([0, 0, zc - bulkhead_thickness/2])
                cube([bulkhead_x, y_low, 0.8], center=true);
            translate([0, 0, zc + bulkhead_thickness/2])
                cube([bulkhead_x, y_high, 0.8], center=true);
        }
    }
}

// ----------------------------
// Hole patterns (XY positions)
// ----------------------------
module b1_hole_positions() {
    ix = 42/2;
    iy = 14/2;

    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx*ix, sy*iy, 0]) children();

    for (sx = [-1, 1])
        translate([sx*ix, 0, 0]) children();

    for (sy = [-1, 1])
        translate([0, sy*iy, 0]) children();

    for (sx = [-1, 1])
        translate([sx*7, 0, 0]) children();
}

module b2_hole_positions() {
    for (sx = [-1, 1])
        translate([sx*7, 0, 0]) children();

    for (sy = [-1, 1])
        translate([0, sy*7, 0]) children();
}

// ----------------------------
// Cutter sets
// ----------------------------
module through_holes_B1(z_center, thk) {
    h = thk + 2;
    translate([0, 0, z_center])
        b1_hole_positions() cyl_hole(m3_hole_d, h);
}

module through_holes_B2(z_center, thk) {
    h = thk + 2;
    translate([0, 0, z_center])
        b2_hole_positions() cyl_hole(m3_hole_d, h);
}

// ----------------------------
// P1d model
// ----------------------------
difference() {
    union() {
        // B1-side plate at z=[0, plate_thickness]
        plate_rect(56, 21, 0, plate_thickness);

        // B2-side plate at z=[body_length - plate_thickness, body_length]
        plate_rect(40, 20, body_length - plate_thickness, plate_thickness);

        // Trapezoidal connector webs + internal bulkheads
        connector_webs();
        bulkheads();

        // Bosses (extend outward away from connector)
        translate([0, 0, -boss_height])
            cylinder(d=B1_boss_d, h=boss_height, center=false);

        translate([0, 0, body_length])
            cylinder(d=B2_boss_d, h=boss_height, center=false);
    }

    // Through-holes (only through the plates)
    through_holes_B1(plate_thickness/2, plate_thickness);
    through_holes_B2(body_length - plate_thickness/2, plate_thickness);
}
