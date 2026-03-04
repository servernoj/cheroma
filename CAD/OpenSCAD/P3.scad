// sizes in mm

// bottom bracket interface
bb_w = 30;
bb_l = 48;
bb_boss_r = 12 / 2;
bb_outer_dx = 40;
bb_outer_dy = 21;
bb_inner_r = 12;
// top bracket interface
tb_w = 20;
tb_l = 40;
tb_boss_r = 6 / 2;
tb_inner_r = 14 / 2;
// web
web_dx = 11.5;
web_h = 150;
web_th = 5;
// bulkhead
bh_th = 5;
// misc
$fn = $preview ? 48 : 96;
b_boss_h = 3;
b_th = 5;
m_hole_r = 3.2 / 2;


module mHole(x = 0, y = 0) {
  translate([x,y, -0.5*b_th])
    cylinder(h = 2.5 * b_th, r = m_hole_r, center = false);
}

module bb_inner_holes() {
  dX = bb_inner_r * sqrt(2) / 2;
  dY = dX;
  mHole(+dX,+dY);
  mHole(-dX,+dY);
  mHole(+dX,-dY);
  mHole(-dX,-dY);
}

module bb_outer_holes() {
  dX = bb_outer_dx / 2;
  dY = bb_outer_dy / 2;
  mHole(+dX,+dY);
  mHole(-dX,+dY);
  mHole(+dX,-dY);
  mHole(-dX,-dY);
}

module tb_holes() {
  dX = tb_inner_r;
  dY = dX;
  mHole(+dX,0);
  mHole(-dX,0);
  mHole(0,-dY);
  mHole(0,+dY);
}

module tb() {
  difference() {
    union() {
      color([1,0,1]) {
        translate([-tb_l/2,-tb_w/2, 0])
          cube([tb_l,tb_w,b_th]);
        translate([0,0,0])
          cylinder(h = b_th + b_boss_h, r = tb_boss_r, center = false);
      }
    }
    tb_holes();
  }
}

module bb() {
  difference() {
    union() {
      color([1,1,0]) {
        translate([-bb_l/2,-bb_w/2, 0])
          cube([bb_l,bb_w,b_th]);
        translate([0,0,-b_boss_h])
          cylinder(h = b_th + b_boss_h, r = bb_boss_r, center = false);
      }
    }
    bb_outer_holes();
    bb_inner_holes();
  }  
}

module web(dx = 0) {  
  translate([dx,0,web_th / 2])
    rotate([90,0,90]) {
      linear_extrude(height = web_th) {
        polygon([
          [0,0],
          [-bb_w/2,0],
          [-bb_w/2,web_th/2],
          [-tb_w/2,web_h+web_th/2],
          [-tb_w/2,web_h+web_th],
          [+tb_w/2,web_h+web_th],
          [+tb_w/2,web_h+web_th/2],
          [+bb_w/2,web_th/2],
          [+bb_w/2,0],
          [0,0]
        ]);
       }
     }
 }
 
 module webs() {
   web(web_dx);
   web(-web_dx-web_th);
 }
 
 module bh(dy = 0) {   
   b_base = (web_h - dy) * (bb_w-tb_w) / web_h + tb_w;
   t_base = (web_h - dy - bh_th) * (bb_w-tb_w) / web_h + tb_w;
   color([0,1,0]) {
     translate([-web_dx-web_th/2,0,b_th + dy]) {
       rotate([90,0,90]) {
         linear_extrude(height = web_dx * 2 + web_th) {
           polygon([
             [0,0],
             [b_base/2,0],
             [t_base/2,bh_th],
             [-t_base/2,bh_th],
             [-b_base/2,0],
             [0,0]
           ]); 
         }
       }
     }
   }
 }
 
module bulkheads(num = 1) {
  for(i = [1:num]) {
    dy = i * web_h / (num+1) - bh_th / 2;
    bh(dy);
  }
}

module b_interfaces() {
  bb();  
  translate([0,0,web_h+web_th])
    tb();
}
 
b_interfaces();
webs();
bulkheads(3);



  


