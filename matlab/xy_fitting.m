function out = xy_fitting(Qcmd, Xmeas, geom0, gamma, opts)
%XY_FITTING  TCP calibration from measured XY only (no Z in residuals).
%
% Same kinematic model as xyz_fitting, but Xmeas has only x,y per sample.
% Geometry geom0 is fixed (not optimized).
%
% Model:
%   Xmeas(:,1:2) ≈ ( R(roll,pitch,yaw) · FK(Qact; geom0) + t )_(x,y)
%
% Joint correction (fixed-gamma: q3 = gamma - q1 - q2):
%   Linear (default):     Qact_i = a_i · Qcmd_i + b_i
%   Quadratic:            Qact_i = c_i · Qcmd_i² + a_i · Qcmd_i + b_i
%
% Inputs:
%   Qcmd  : N×3  commanded joint angles [q0,q1,q2] (deg)
%   Xmeas : N×2  measured TCP x,y (mm), same frame as xyz_fitting XY
%   geom0 : struct with H, L1, L2, L3, dX (mm) — used fixed, not fitted
%   gamma : fixed tool pitch (deg), typically 180
%   opts  : (optional) struct with fields:
%             .quadratic (logical, default false) — quadratic joint correction
%
% Output: struct with fitted parameters and diagnostics (XY residuals only).

if nargin < 5, opts = struct(); end
if ~isfield(opts, 'quadratic'), opts.quadratic = false; end

nJ = 3;
N = size(Qcmd, 1);
if size(Qcmd, 2) ~= 3
  error('xy_fitting: Qcmd must be N×3 with columns [q0,q1,q2].');
end
if size(Xmeas, 1) ~= N || size(Xmeas, 2) ~= 2
  error('xy_fitting: Xmeas must be N×2 with N = size(Qcmd,1).');
end

% ---- Parameter vector layout ----
% [roll; pitch; yaw; tx; ty; tz; a(nJ); b(nJ); c2(nJ)?]

P0 = [0; 0; 0; 0; 0; 0];
% roll/pitch fixed ~0 (avoid exact [0,0] if optimizer complains); yaw in deg
lb = [0; 0; -50; -500; -500; -500];
ub = [ 0;  0;  50;  500;  500;  500];
% lb = [-1e-6; -1e-6; -50; -500; -500; -500];
% ub = [ 1e-6;  1e-6;  50;  500;  500;  500];

P0 = [P0; ones(nJ, 1)];
lb = [lb; 0.85 * ones(nJ, 1)];
ub = [ub; 1.15 * ones(nJ, 1)];

P0 = [P0; zeros(nJ, 1)];
lb = [lb; [-30; -30; -30]];
ub = [ub; [ 30;  30;  30]];

if opts.quadratic
  P0 = [P0; zeros(nJ, 1)];
  lb = [lb; -0.005 * ones(nJ, 1)];
  ub = [ub;  0.005 * ones(nJ, 1)];
end

optim = optimoptions('lsqnonlin', ...
  'Display', 'iter', ...
  'MaxFunctionEvaluations', 5e5, ...
  'MaxIterations', 2000);

costFn = @(P) calc_residuals_xy(P, Qcmd, Xmeas, geom0, gamma, nJ, opts);
P_star = lsqnonlin(costFn, P0, lb, ub, optim);

idx = 1;
out.roll  = P_star(idx);     idx = idx + 1;
out.pitch = P_star(idx);     idx = idx + 1;
out.yaw   = P_star(idx);     idx = idx + 1;
out.t     = P_star(idx:idx+2); idx = idx + 3;

out.a = P_star(idx:idx+nJ-1);  idx = idx + nJ;
out.b = P_star(idx:idx+nJ-1);  idx = idx + nJ;

if opts.quadratic
  out.c2 = P_star(idx:idx+nJ-1); idx = idx + nJ;
end

r = costFn(P_star);
out.resnorm     = sum(r .^ 2);
out.rmse        = sqrt(out.resnorm / numel(r));
out.rmse_xy     = rmse_per_axis_xy(r);
out.errors      = reshape(r, [2, N])';
out.error_norms = sqrt(sum(out.errors .^ 2, 2));
out.max_error   = max(out.error_norms);

end


function r = calc_residuals_xy(P, Qcmd, Xmeas, geom0, gamma, nJ, opts)

idx = 1;
roll  = P(idx);             idx = idx + 1;
pitch = P(idx);             idx = idx + 1;
yaw   = P(idx);             idx = idx + 1;
t     = P(idx:idx+2);       idx = idx + 3;
a     = P(idx:idx+nJ-1);    idx = idx + nJ;
b     = P(idx:idx+nJ-1);    idx = idx + nJ;

if opts.quadratic
  c2 = P(idx:idx+nJ-1);     idx = idx + nJ;
else
  c2 = zeros(nJ, 1);
end

R = rotation_matrix(roll, pitch, yaw);

N = size(Qcmd, 1);
r = zeros(2 * N, 1);

for i = 1:N
  Qc = Qcmd(i, :)';
  Qact = c2 .* Qc .^ 2 + a .* Qc + b;
  q3 = gamma - Qact(2) - Qact(3);

  Xpred = FK([Qact; q3], geom0);
  Xpred = R * Xpred + t;

  r(2*(i-1)+1 : 2*i) = Xpred(1:2) - Xmeas(i, :)';
end

end


function R = rotation_matrix(roll, pitch, yaw)
cr = cosd(roll);  sr = sind(roll);
cp = cosd(pitch); sp = sind(pitch);
cy = cosd(yaw);   sy = sind(yaw);

Rx = [1 0 0; 0 cr -sr; 0 sr cr];
Ry = [cp 0 sp; 0 1 0; -sp 0 cp];
Rz = [cy -sy 0; sy cy 0; 0 0 1];
R  = Rz * Ry * Rx;
end


function rmse = rmse_per_axis_xy(r)
N = numel(r) / 2;
R = reshape(r, [2, N]);
rmse = sqrt(mean(R .^ 2, 2));
end


function X = FK(Q, geom)
q0 = Q(1); q1 = Q(2); q2 = Q(3); q3 = Q(4);

Gamma = q1 + q2 + q3;
rr = geom.dX * cosd(q1) ...
   + geom.L1 * sind(q1) ...
   + geom.L2 * sind(q1 + q2) ...
   + geom.L3 * sind(Gamma);

X = [
  rr * cosd(q0);
  rr * sind(q0);
  geom.H - geom.dX * sind(q1) + geom.L1 * cosd(q1) ...
         + geom.L2 * cosd(q1 + q2) + geom.L3 * cosd(Gamma)
];
end
