function out = xyz_registration_fitting_6dof(Qcmd, Xmeas, geom0)
%XYZ_REGISTRATION_FITTING_6DOF Fit a full 3D rigid transform (no a/b).
%
% Model:
%   Xmeas ≈ R(roll,pitch,yaw) * Xpred + t
%
% Params:
%   roll  about +X (deg)
%   pitch about +Y (deg)
%   yaw   about +Z (deg)
%   t = [tx;ty;tz] (mm)
%
% Inputs:
%   Qcmd  : N×4 (deg or rad) [q0,q1,q2,q3_cmd]  (as logged)
%   Xmeas : N×3 (mm)  [x,y,z] measured
%   geom0 : struct with fields H,L1,L2,L3,dX (mm) (fixed geometry)
%
% Output:
%   out.roll, out.pitch, out.yaw, out.t
%   out.resnorm, out.rmse, out.rmse_xyz
%

opts = optimoptions('lsqnonlin', 'Display', 'iter', 'MaxFunctionEvaluations', 1e5);

% Params: [roll; pitch; yaw; tx; ty; tz]
P0 = [0; 0; 0; 0; 0; 0];

% Keep angles modest; translations wide.
lb = [-20; -20; -20; -2000; -2000; -2000];
ub = [20; 20; 20; 2000; 2000; 2000];

P_star = lsqnonlin(@(P)residual_xyz_reg6(P, Qcmd, Xmeas, geom0), P0, lb, ub, opts);

out.roll = P_star(1);
out.pitch = P_star(2);
out.yaw = P_star(3);
out.t = P_star(4:6);

r = residual_xyz_reg6(P_star, Qcmd, Xmeas, geom0);
out.resnorm = sum(r .^ 2);
out.rmse = sqrt(out.resnorm / numel(r));
out.rmse_xyz = rmse_xyz_from_r(r);
end

function r = residual_xyz_reg6(P, Qcmd, Xmeas, geom0)
roll = P(1);
pitch = P(2);
yaw = P(3);
t = P(4:6);

% R = Rz(yaw) * Ry(pitch) * Rx(roll)
cr = cosd(roll); sr = sind(roll);
cp = cosd(pitch); sp = sind(pitch);
cy = cosd(yaw); syaw = sind(yaw);

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
  q3 = Qcmd(i, 4);

  Xpred = FK([q0; q1; q2; q3], geom0); % model frame
  Xpred = R * Xpred + t; % predicted in measurement frame

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
rmse_xyz = sqrt(mean(R .^ 2, 2));
end

function X = FK(Q, geom0)
% Mirror of apps/api/src/modules/kinematics.js FK_ + FK (float, no rounding).
% Angles are in degrees.
q0 = Q(1); q1 = Q(2); q2 = Q(3); q3 = Q(4);

% Geometry constants must match config.json / JS.

Gamma = q1 + q2 + q3;

r = geom0.dX * cosd(q1) + geom0.L1 * sind(q1) + geom0.L2 * sind(q1 + q2) + geom0.L3 * sind(Gamma);
Pref = [
  r * cosd(q0);
  r * sind(q0);
  geom0.H - geom0.dX * sind(q1) + geom0.L1 * cosd(q1) + geom0.L2 * cosd(q1 + q2) + geom0.L3 * cosd(Gamma)
  ];
X = Pref;
end
