function out = xyz_fitting(Qcmd, Xmeas, geom0, gamma, opts)
%XYZ_FITTING  Single-step model fitting for robotic arm TCP calibration.
%
% Combines rigid-body registration and per-joint correction into one
% optimization, replacing the sequential xyz_registration_fitting_6dof
% followed by xyz_ab_fitting.
%
% Model:
%   Xmeas ≈ R(roll,pitch,yaw) · FK(Qact; geom) + t
%
% Joint correction (fixed-gamma: q3 = gamma - q1 - q2):
%   Linear (default):     Qact_i = a_i · Qcmd_i + b_i
%   Quadratic:            Qact_i = c_i · Qcmd_i² + a_i · Qcmd_i + b_i
%
% Inputs:
%   Qcmd  : N×4  commanded joint angles (deg)
%   Xmeas : N×3  measured TCP positions (mm)
%   geom0 : struct with H, L1, L2, L3, dX (mm)
%   gamma : fixed tool pitch (deg), typically 180
%   opts  : (optional) struct with fields:
%             .freeGeom  (cell array of strings, default {}) – geometry params
%                        to fit, subset of {'H','L1','L2','L3','dX'}.
%             .geomRange (scalar, default 10) – search half-width in mm
%                        around geom0 for freed geometry params.
%             .quadratic (logical, default false) – quadratic joint correction
%             .init      (struct, optional) – initial guess from a previous fit
%                        with fields: roll, pitch, yaw, t, a, b [, c2] [, geom]
%
% Output: struct with fitted parameters and diagnostics.
%
% Usage:
%   % Equivalent to current two-step process:
%   out = xyz_fitting(Qcmd, Xmeas, geom0, 180)
%
%   % Seed with known two-step solution:
%   prev = struct('roll',0.13, 'pitch',4.48, 'yaw',1.85, ...
%                 't',[-18.44;-0.60;9.19], 'a',[0.94;0.94;0.92], 'b',[-0.004;0.80;9.26]);
%   out = xyz_fitting(Qcmd, Xmeas, geom0, 180, struct('init', prev))
%
%   % Free only link lengths (not H or dX):
%   out = xyz_fitting(Qcmd, Xmeas, geom0, 180, struct('freeGeom', {{'L1','L2','L3'}}))

if nargin < 5, opts = struct(); end
if ~isfield(opts, 'freeGeom'),  opts.freeGeom = {}; end
if ~isfield(opts, 'geomRange'), opts.geomRange = 10; end
if ~isfield(opts, 'quadratic'), opts.quadratic = false; end
if ~isfield(opts, 'init'),      opts.init = []; end

nJ = 3;
hasInit = ~isempty(opts.init);

allGeomNames = {'H', 'L1', 'L2', 'L3', 'dX'};
geomMask = ismember(allGeomNames, opts.freeGeom);
nGeom = sum(geomMask);

% ---- Parameter vector layout ----
% [roll; pitch; yaw; tx; ty; tz; a(nJ); b(nJ); c2(nJ)?; geom(nGeom)?]

% Registration (6)
if hasInit
  P0 = [opts.init.roll; opts.init.pitch; opts.init.yaw; opts.init.t(:)];
else
  P0 = [0; 0; 0; 0; 0; 0];
end
lb = [-20; -20; -20; -500; -500; -500];
ub = [ 20;  20;  20;  500;  500;  500];

% Linear gains a (nJ), near 1
if hasInit && isfield(opts.init, 'a')
  P0 = [P0; opts.init.a(:)];
else
  P0 = [P0; ones(nJ, 1)];
end
lb = [lb; 0.85 * ones(nJ, 1)];
ub = [ub; 1.15 * ones(nJ, 1)];

% Offsets b (nJ)
if hasInit && isfield(opts.init, 'b')
  P0 = [P0; opts.init.b(:)];
else
  P0 = [P0; zeros(nJ, 1)];
end
lb = [lb; [-30; -20; -20]];
ub = [ub; [ 30;  20;  20]];

% Quadratic coefficients c2 (nJ), optional
if opts.quadratic
  if hasInit && isfield(opts.init, 'c2')
    P0 = [P0; opts.init.c2(:)];
  else
    P0 = [P0; zeros(nJ, 1)];
  end
  lb = [lb; -0.005 * ones(nJ, 1)];
  ub = [ub;  0.005 * ones(nJ, 1)];
end

% Geometry (nGeom), optional – only the selected params
if nGeom > 0
  freeNames = allGeomNames(geomMask);
  g0_free = zeros(nGeom, 1);
  for k = 1:nGeom
    g0_free(k) = geom0.(freeNames{k});
  end
  if hasInit && isfield(opts.init, 'geom')
    ig = opts.init.geom;
    gi = zeros(nGeom, 1);
    for k = 1:nGeom
      if isfield(ig, freeNames{k})
        gi(k) = ig.(freeNames{k});
      else
        gi(k) = g0_free(k);
      end
    end
    P0 = [P0; gi];
  else
    P0 = [P0; g0_free];
  end
  lb = [lb; g0_free - opts.geomRange];
  ub = [ub; g0_free + opts.geomRange];
end

% ---- Optimize ----
optim = optimoptions('lsqnonlin', ...
  'Display', 'iter', ...
  'MaxFunctionEvaluations', 5e5, ...
  'MaxIterations', 2000);

costFn = @(P) calc_residuals(P, Qcmd, Xmeas, geom0, gamma, nJ, opts, geomMask, allGeomNames);
P_star = lsqnonlin(costFn, P0, lb, ub, optim);

% ---- Unpack results ----
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

if nGeom > 0
  freeNames = allGeomNames(geomMask);
  for k = 1:nGeom
    out.geom.(freeNames{k}) = P_star(idx); idx = idx + 1;
  end
end

% ---- Diagnostics ----
r = costFn(P_star);
N = size(Qcmd, 1);
out.resnorm     = sum(r .^ 2);
out.rmse        = sqrt(out.resnorm / numel(r));
out.rmse_xyz    = rmse_per_axis(r);
out.errors      = reshape(r, [3, N])';
out.error_norms = sqrt(sum(out.errors .^ 2, 2));
out.max_error   = max(out.error_norms);

end


function r = calc_residuals(P, Qcmd, Xmeas, geom0, gamma, nJ, opts, geomMask, allGeomNames)

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

geom = geom0;
nGeom = sum(geomMask);
if nGeom > 0
  freeNames = allGeomNames(geomMask);
  for k = 1:nGeom
    geom.(freeNames{k}) = P(idx); idx = idx + 1;
  end
end

R = rotation_matrix(roll, pitch, yaw);

N = size(Qcmd, 1);
r = zeros(3 * N, 1);

for i = 1:N
  Qc = Qcmd(i, 1:3)';
  Qact = c2 .* Qc .^ 2 + a .* Qc + b;
  q3 = gamma - Qact(2) - Qact(3);

  Xpred = FK([Qact; q3], geom);
  Xpred = R * Xpred + t;

  r(3*(i-1)+1 : 3*i) = Xpred - Xmeas(i, :)';
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


function rmse = rmse_per_axis(r)
N = numel(r) / 3;
R = reshape(r, [3, N]);
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
