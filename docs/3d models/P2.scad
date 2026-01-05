// P2a part (aligned with P1d design): B3 - P2a - B2
//
// Design requirements (per latest):
// - 2 trapezoidal side webs ("struts")
// - 3 stabilizing plates (bulkheads), parallel to bracket interfaces
// - all plates are solid
// - bracket interface plates are 5mm thick
// - simple through holes for M3 bolts
// - bosses match bracket center holes:
//   - B3: Ø6
//   - B2: Ø6
//
// Coordinate system:
// - Origin at center of B3 interface plane
// - Z axis goes from B3 side to B2 side

// ----------------------------
// Global parameters
// ----------------------------
body_length = 200;       // mm (distance between the two interface planes, excluding bosses)

plate_thickness = 5;     // mm (bracket interface plate thickness)

// Through holes
m3_hole_d = 3.2;         // mm (clearance)

// Bosses (locating features)
B3_boss_d = 6;           // mm
B2_boss_d = 6;           // mm
boss_height = 3;         // mm (protrusion into bracket hole)

// Connector webs
web_thickness = 5;       // mm (plate thickness, along X)
// Match P1d-style clearance around B2 holes at x=±7:
// put the webs farther out so they don't crowd the B2 hole openings on the connector side.
web_x = 14;              // mm (center X position of each web)
B3_plate_x = 50;         // mm (B3 interface plate X size)
B3_interface_width = 20; // mm (Y width of B3 interface)
B2_interface_width = 20; // mm (Y width of B2 interface)
web_overlap = 0.6;       // mm (overlap into interface plates for a solid joint)

// Stabilizing plates (bulkheads)
bulkhead_count = 3;
bulkhead_thickness = 5;  // mm (along Z)
// Bulkhead footprint (XY). Sized to tie both side webs together.
bulkhead_x = 2*(web_x + web_thickness/2);  // mm

// B3 hole-grid definition
square_diag = 14;        // mm (diagonal of each square)

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

module trapezoid_web_at_x(xc, z_inner_B3, z_inner_B2) {
    // Builds a trapezoidal web (in Y-Z), thickened in X, using hull between two thin slices.
    eps = 1; // mm slice thickness for hull

    z1 = z_inner_B3 - web_overlap;
    z2 = z_inner_B2 + web_overlap;

    hull() {
        translate([xc, 0, z1])
            cube([web_thickness, B3_interface_width, eps], center=true);
        translate([xc, 0, z2])
            cube([web_thickness, B2_interface_width, eps], center=true);
    }
}

module connector_webs() {
    z_inner_B3 = plate_thickness;
    z_inner_B2 = body_length - plate_thickness;

    // B3-side clearance:
    // The B3 M3 holes are near x≈±14.85, so if we start webs at x=±14 near the inner face
    // they can partially cover those holes from the connector side.
    // For the lowest section (B3 interface -> first bulkhead), shift the webs outward so
    // they align with the short-side edges of the B3 rectangle (x≈±25), then transition
    // back to x=±web_x by the first bulkhead.

    // Compute the start of the first bulkhead (lower face)
    span = z_inner_B2 - z_inner_B3;
    first_bulkhead_zc = z_inner_B3 + span * (1/(bulkhead_count+1));
    z_seg_end = first_bulkhead_zc - bulkhead_thickness/2; // end of the lowest section

    // Web center aligned to B3 short-side edges (x=±(B3_plate_x/2 - web_thickness/2))
    x_edge_B3 = (B3_plate_x/2) - (web_thickness/2);

    // Lowest section: transition from x_edge_B3 at B3 inner face to x=web_x at first bulkhead start
    for (sx = [-1, 1]) {
        hull() {
            translate([sx*x_edge_B3, 0, z_inner_B3 - web_overlap])
                cube([web_thickness, B3_interface_width, 1], center=true);
            translate([sx*web_x, 0, z_seg_end + web_overlap])
                cube([web_thickness, B3_interface_width, 1], center=true);
        }
    }

    // Upper section: standard webs at x=±web_x from first bulkhead start to B2 inner face
    for (sx = [-1, 1]) {
        hull() {
            translate([sx*web_x, 0, z_seg_end - web_overlap])
                cube([web_thickness, B3_interface_width, 1], center=true);
            translate([sx*web_x, 0, z_inner_B2 + web_overlap])
                cube([web_thickness, B2_interface_width, 1], center=true);
        }
    }
}

function clamp01(t) = (t < 0) ? 0 : (t > 1) ? 1 : t;
function lerp(a, b, t) = a + (b - a) * t;
function web_width_at_z(z) =
    // Linear taper from B3_interface_width at z=plate_thickness to B2_interface_width at z=body_length-plate_thickness
    lerp(B3_interface_width, B2_interface_width,
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
module b3_hole_positions() {
    // 8 holes from 3 edge-sharing squares (see B3.scad)
    a = square_diag / sqrt(2); // side length

    xs = [-1.5*a, -0.5*a, 0.5*a, 1.5*a];
    ys = [-0.5*a, 0.5*a];

    for (x = xs, y = ys)
        translate([x, y, 0]) children();
}

module b2_hole_positions() {
    // 4 holes on lines of symmetry at (±7,0) and (0,±7)
    for (sx = [-1, 1])
        translate([sx*7, 0, 0]) children();

    for (sy = [-1, 1])
        translate([0, sy*7, 0]) children();
}

// ----------------------------
// Cutter sets
// ----------------------------
module through_holes_B3(z_center, thk) {
    h = thk + 2;
    translate([0, 0, z_center])
        b3_hole_positions() cyl_hole(m3_hole_d, h);
}

module through_holes_B2(z_center, thk) {
    h = thk + 2;
    translate([0, 0, z_center])
        b2_hole_positions() cyl_hole(m3_hole_d, h);
}

// ----------------------------
// P2a model
// ----------------------------
difference() {
    union() {
        // B3-side plate at z=[0, plate_thickness]
        plate_rect(50, 20, 0, plate_thickness);

        // B2-side plate at z=[body_length - plate_thickness, body_length]
        plate_rect(40, 20, body_length - plate_thickness, plate_thickness);

        // Trapezoidal connector webs + internal bulkheads
        connector_webs();
        bulkheads();

        // Bosses (extend outward away from connector)
        translate([0, 0, -boss_height])
            cylinder(d=B3_boss_d, h=boss_height, center=false);

        translate([0, 0, body_length])
            cylinder(d=B2_boss_d, h=boss_height, center=false);
    }

    // Through-holes (only through the plates)
    through_holes_B3(plate_thickness/2, plate_thickness);
    through_holes_B2(body_length - plate_thickness/2, plate_thickness);
}
