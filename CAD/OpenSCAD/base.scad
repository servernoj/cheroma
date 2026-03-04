// sizes in mm

$fn = $preview ? 48 : 96;
baseRadius = 82 / 2; 
innerRadius = 69.5 / 2;
mHoleRadius = 3.2 / 2;
mHolePatternDegree = 60;
thickness = 5;
bossHeight = 2;
bracketWidth = 30;
bracketLength = 48;
bracketHolesWidth = 21;
bracketInterfaceHeight = 1;
bracketHolesLength = 40;
bossRadius = 12 / 2;
wireHoleSize = 10;
wireHoleOffset = 30;


module mHole(x = 0, y = 0) {
  translate([x,y, -0.5*thickness])
    cylinder(h = 2.5 * thickness, r = mHoleRadius, center = false);
}

module mHoles() {
  dX = innerRadius * cos(mHolePatternDegree);
  dY = innerRadius * sin(mHolePatternDegree);
  mHole(+dX,+dY);
  mHole(-dX,+dY);
  mHole(+dX,-dY);
  mHole(-dX,-dY);
}

module bracketHoles() {
  dX = bracketHolesLength / 2;
  dY = bracketHolesWidth / 2;
  mHole(+dX,+dY);
  mHole(-dX,+dY);
  mHole(+dX,-dY);
  mHole(-dX,-dY);
}

module wiresHole() {
  translate([-wireHoleSize/2,-wireHoleOffset,-0.5*thickness])
    cube([wireHoleSize,wireHoleSize,2.5 * thickness]);
}

module bracketInterface() {
  color([1,1,0]) {
    translate([-bracketLength/2,-bracketWidth/2, 0])
      cube([bracketLength,bracketWidth,thickness]);      
    cylinder(h = thickness + bossHeight, r = bossRadius, center = false);
  }
}

module base() {
  cylinder(h = thickness, r = baseRadius);
}

difference() {
  union() {
    base();
    translate([0,0,bracketInterfaceHeight])
      bracketInterface();
  }
  mHoles();
  bracketHoles();
  wiresHole();  
}