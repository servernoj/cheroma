function out = xy_fitting(Qcmd, XYmeas)
% Qcmd: N×3 (deg) [q0,q1,q2]
% XYmeas: N×2 (mm) [x,y]

  opts = optimoptions('lsqnonlin', 'Display','iter', 'MaxFunctionEvaluations', 1e5);

  % -------- Stage A: offsets only
  b0 = zeros(3,1);
  b_star = lsqnonlin(@(b)residual_xy_b_only(b, Qcmd, XYmeas), b0, [], [], opts);
  out.stageA.b = b_star;

  % -------- Stage B (optional): scales + offsets
  doStageB = true;
  if doStageB
    P0 = [ones(3,1); b_star];             % P=[a;b]
    lb = [0.95*ones(3,1); -20*ones(3,1)];
    ub = [1.05*ones(3,1);  20*ones(3,1)];
    P_star = lsqnonlin(@(P)residual_xy_a_b(P, Qcmd, XYmeas), P0, lb, ub, opts);
    out.stageB.a = P_star(1:3);
    out.stageB.b = P_star(4:6);
  end
end

function r = residual_xy_b_only(b, Qcmd, XYmeas)
% b: 3×1 for [q0,q1,q2] offsets in degrees
  N = size(Qcmd,1);
  r = zeros(2*N,1);
  for i = 1:N
    Qphys = Qcmd(i,:)' + b;           % 3×1 (deg)
    Xpred = FK(Qphys);   % 3×1 (mm)
    ri = [Xpred(1) - XYmeas(i,1);
          Xpred(2) - XYmeas(i,2)];
    r(2*(i-1)+1:2*i) = ri;
  end
end

function r = residual_xy_a_b(P, Qcmd, XYmeas)
% P: 6×1 where a=P(1:3), b=P(4:6)
  a = P(1:3);
  b = P(4:6);
  N = size(Qcmd,1);
  r = zeros(2*N,1);
  for i = 1:N
    Qphys = a .* Qcmd(i,:)' + b;      % 3×1 (deg)
    Xpred = FK(Qphys);   % 3×1 (mm)
    ri = [Xpred(1) - XYmeas(i,1);
          Xpred(2) - XYmeas(i,2)];
    r(2*(i-1)+1:2*i) = ri;
  end
end

function X = FK(Q)
% FK for gamma = pi case, using q0,q1,q2 in degrees.
% Replace these constants with your current model values.
  q0 = Q(1); q1 = Q(2); q2 = Q(3);

  H  = 130;
  L1 = 211;
  L2 = 265;
  L3 = 100;
  dX = 20;

  r = (dX*cosd(q1) + L1*sind(q1)) + L2*sind(q1 + q2);
  z = H - L3 - dX*sind(q1) + L1*cosd(q1) + L2*cosd(q1 + q2); %#ok

  x = r*cosd(q0);
  y = r*sind(q0);

  X = [x; y; z];
end