function out = xyz_registration_fitting_6dof_affine(Qcmd, Xmeas, gamma)
%XYZ_REGISTRATION_FITTING_6DOF_AFFINE Fit a full 3D rigid transform + per-axis affine corrections (no a/b).
%
% Model:
%   Xmeas ≈ R(roll,pitch,yaw) * U(Xpred; sx,ox, sy,oy, oz) + t
%
% This matches a runtime "toModel" mapping of the form:
%   u = R^T * (X_meas - t)
%   x_model = sx*u_x + ox
%   y_model = sy*u_y + oy
%   z_model = u_z + oz
%
% Params:
%   roll  about +X (deg)
%   pitch about +Y (deg)
%   yaw   about +Z (deg)
%   t = [tx;ty;tz] (mm)
%   sx, ox: x scale (dimensionless) + x offset (mm) in model frame after undoing R,t
%   sy, oy: y scale (dimensionless) + y offset (mm) in model frame after undoing R,t
%   oz    : z offset (mm) in model frame after undoing R,t
%
% Inputs:
%   Qcmd  : N×4 (deg) [q0,q1,q2,q3]  (as logged)
%   Xmeas : N×3 (mm)  [x,y,z] measured
%   gamma : optional (deg). If provided, enforce q3 = gamma - q1 - q2.
%
% Output:
%   out.roll, out.pitch, out.yaw, out.t
%   out.sx, out.ox, out.sy, out.oy, out.oz
%   out.resnorm, out.rmse, out.rmse_xyz
%
  if nargin < 3
    gamma = [];
  end

  opts = optimoptions('lsqnonlin', 'Display', 'iter', 'MaxFunctionEvaluations', 1e5);

  % Params:
  %   [roll; pitch; yaw; tx; ty; tz; sx; ox; sy; oy; oz]
  P0 = [0; 0; 0; 0; 0; 0; 1; 0; 1; 0; 0];

  % Keep angles modest; translations wide; scales near 1; offsets moderate.
  lb = [-10; -10; -15; -2000; -2000; -2000; 0.90; -200; 0.90; -200; -200];
  ub = [ 10;  10;  15;  2000;  2000;  2000; 1.10;  200; 1.10;  200;  200];

  P_star = lsqnonlin(@(P)residual_xyz_reg_affine(P, Qcmd, Xmeas, gamma), P0, lb, ub, opts);

  out.roll = P_star(1);
  out.pitch = P_star(2);
  out.yaw = P_star(3);
  out.t = P_star(4:6);
  out.sx = P_star(7);
  out.ox = P_star(8);
  out.sy = P_star(9);
  out.oy = P_star(10);
  out.oz = P_star(11);

  r = residual_xyz_reg_affine(P_star, Qcmd, Xmeas, gamma);
  out.resnorm = sum(r.^2);
  out.rmse = sqrt(out.resnorm / numel(r));
  out.rmse_xyz = rmse_xyz_from_r(r);
end

function r = residual_xyz_reg_affine(P, Qcmd, Xmeas, gamma)
  roll = P(1);
  pitch = P(2);
  yaw = P(3);
  t = P(4:6);
  sxScale = P(7);
  ox = P(8);
  syScale = P(9);
  oy = P(10);
  oz = P(11);

  % R = Rz(yaw) * Ry(pitch) * Rx(roll)
  cr = cosd(roll);  sr = sind(roll);
  cp = cosd(pitch); sp = sind(pitch);
  cy = cosd(yaw);   syaw = sind(yaw);

  Rx = [1, 0, 0; 0, cr, -sr; 0, sr, cr];
  Ry = [cp, 0, sp; 0, 1, 0; -sp, 0, cp];
  Rz = [cy, -syaw, 0; syaw, cy, 0; 0, 0, 1];
  R = Rz * Ry * Rx;

  N = size(Qcmd, 1);
  r = zeros(3 * N, 1);

  for i = 1:N
    q0 = Qcmd(i, 1);
    q1 = Qcmd(i, 2);
    q2 = Qcmd(i, 3);
    if isempty(gamma)
      q3 = Qcmd(i, 4);
    else
      q3 = gamma - q1 - q2;
    end

    Xpred = FK([q0; q1; q2; q3]); % model frame

    % Undo the "toModel" affine (sx/ox, sy/oy, oz) to predict measurement frame:
    %   u_x = (x_model - ox)/sx
    %   u_y = (y_model - oy)/sy
    %   u_z = (z_model - oz)
    Xu = [(Xpred(1) - ox)/sxScale; (Xpred(2) - oy)/syScale; (Xpred(3) - oz)];
    Xpred = R * Xu + t;

    ri = [ ...
            Xpred(1) - Xmeas(i, 1); ...
            Xpred(2) - Xmeas(i, 2); ...
            Xpred(3) - Xmeas(i, 3); ...
          ];
    r(3 * (i - 1) + 1:3 * i) = ri;
  end
end

function rmse_xyz = rmse_xyz_from_r(r)
  N = numel(r) / 3;
  R = reshape(r, [3, N]);
  rmse_xyz = sqrt(mean(R.^2, 2));
end

function X = FK(Q)
  % Mirror of apps/api/src/modules/kinematics.js FK_ + FK (float, no rounding).
  % Angles are in degrees.
  q0 = Q(1); q1 = Q(2); q2 = Q(3); q3 = Q(4); q4 = q0;

  % Geometry constants must match config.json / JS.
  H = 130;
  L1 = 211;
  L2 = 265;
  L3 = 50;
  dX = 20;
  dU = 0;
  dV = -10;
  La = 163;
  R = 27;

  Gamma = q1 + q2 + q3;

  r = dX * cosd(q1) + L1 * sind(q1) + L2 * sind(q1 + q2) + L3 * sind(Gamma);
  t = [sind(Gamma) * cosd(q0); sind(Gamma) * sind(q0); cosd(Gamma)];
  v = [-sind(q0); cosd(q0); 0];
  u = [cosd(q0) * cosd(Gamma); sind(q0) * cosd(Gamma); -sind(Gamma)];

  Pref = [
          r * cosd(q0);
          r * sind(q0);
          H - dX * sind(q1) + L1 * cosd(q1) + L2 * cosd(q1 + q2) + L3 * cosd(Gamma)
          ];

  Pspin = dU * u + dV * v;
  Pecc = R * (cosd(q4) * u + sind(q4) * v);
  Delta = Pspin + Pecc + La * t;

  X = Pref + Delta;
end

