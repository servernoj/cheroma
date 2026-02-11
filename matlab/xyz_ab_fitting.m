function out = xyz_ab_fitting(Qcmd, Xmeas, reg, geom0, gamma)
%XYZ_AB_FITTING Stage-2 fit: joint angle gain/offset (a,b) with fixed registration.
%
% This is meant to be used AFTER you fit a rigid registration (Stage-1):
%   Xmeas ≈ R(roll,pitch,yaw) * Xpred + t
%
% Stage-2 then:
%   1) converts each measured point into the model frame:
%        Xmodel = R' * (Xmeas - t)
%   2) fits joint angle corrections so that:
%        FK(Qact; geom0) ≈ Xmodel
%
% Correction model (angles in degrees):
%   Stage A: offsets only
%     Qact = Qcmd + b
%   Stage B: gains + offsets
%     Qact = a .* Qcmd + b
%
% Runtime note:
%   If you want the physical robot to achieve a desired model-space angle Qdes,
%   but your fitted mapping is Qact = a*Qcmd + b, then you should command:
%     Qcmd = (Qdes - b) ./ a
%
% Inputs:
%   Qcmd  : N×4 (deg or rad) [q0,q1,q2,q3_cmd]   (as logged from IK)
%   Xmeas : N×3 (mm)         [x,y,z]            (measured in your measurement frame)
%   reg   : struct with fields roll,pitch,yaw (deg), t (3×1 mm)
%           (output of xyz_registration_fitting_6dof)
%   geom0 : struct with fields H,L1,L2,L3,dX (mm) (fixed geometry)
%   gamma : optional fixed tool pitch (deg or rad). If provided, we DO NOT fit q3.
%           Instead, we compute:
%             q3 = gamma - q1 - q2
%           This is the correct mode when your IK uses fixed gamma=180.
%
% Output:
%   out.stageA.b, out.stageA.rmse_xyz, out.stageA.rmse
%   out.stageB.a, out.stageB.b, out.stageB.rmse_xyz, out.stageB.rmse
%

  if nargin < 4
    error('xyz_ab_fitting(Qcmd, Xmeas, reg, geom0[, gamma]) requires at least 4 inputs');
  end
  if nargin < 5
    gamma = [];
  end

  requiredReg = {'roll','pitch','yaw','t'};
  for k = 1:numel(requiredReg)
    if ~isfield(reg, requiredReg{k})
      error('reg missing field: %s', requiredReg{k});
    end
  end
  if ~isequal(size(reg.t), [3,1]) && ~isequal(size(reg.t), [1,3])
    error('reg.t must be 3x1 (mm)');
  end
  reg.t = reg.t(:);

  requiredGeom = {'H','L1','L2','L3','dX'};
  for k = 1:numel(requiredGeom)
    if ~isfield(geom0, requiredGeom{k})
      error('geom0 missing field: %s', requiredGeom{k});
    end
  end

  % Auto-detect radians input and convert to degrees (FK uses sind/cosd).
  if max(abs(Qcmd), [], 'all') <= 2*pi + 1e-3
    Qcmd = Qcmd * 180 / pi;
  end

  % Accept gamma in radians (pi) or degrees (180).
  if ~isempty(gamma) && abs(gamma) <= 2*pi + 1e-6
    gamma = gamma * 180 / pi;
  end

  opts = optimoptions('lsqnonlin', 'Display', 'iter', 'MaxFunctionEvaluations', 2e5);

  % Convert measured points to model frame once, using fixed reg.
  Xmodel = meas_to_model(Xmeas, reg);

  % If gamma is fixed, q3 is not an independent DOF; fit only q0..q2.
  fitFixedGamma = ~isempty(gamma);
  out.mode.fixedGamma = fitFixedGamma;
  out.mode.gamma = gamma;

  % -------- Stage A: b only
  if fitFixedGamma
    b0 = zeros(3, 1);
    lbA = [-30; -20; -20];
    ubA = [ 30;  20;  20];
  else
    b0 = zeros(4, 1);
    lbA = [-30; -20; -20; -20];
    ubA = [ 30;  20;  20;  20];
  end

  b_star = lsqnonlin(@(b)residual_b_only(b, Qcmd, Xmodel, geom0, gamma), b0, lbA, ubA, opts);
  out.stageA.b = b_star;
  rA = residual_b_only(b_star, Qcmd, Xmodel, geom0, gamma);
  out.stageA.resnorm = sum(rA.^2);
  out.stageA.rmse = sqrt(out.stageA.resnorm / numel(rA));
  out.stageA.rmse_xyz = rmse_xyz_from_r(rA);

  % -------- Stage B: a + b (keep a tightly near 1)
  doStageB = true;
  if doStageB
    if fitFixedGamma
      P0 = [ones(3, 1); b_star]; % [a(3); b(3)]
      lbB = [0.98*ones(3,1); lbA];
      ubB = [1.02*ones(3,1); ubA];
      P_star = lsqnonlin(@(P)residual_a_b(P, Qcmd, Xmodel, geom0, gamma), P0, lbB, ubB, opts);
      out.stageB.a = P_star(1:3);
      out.stageB.b = P_star(4:6);
    else
      P0 = [ones(4, 1); b_star]; % [a(4); b(4)]
      lbB = [0.98*ones(4,1); lbA];
      ubB = [1.02*ones(4,1); ubA];
      P_star = lsqnonlin(@(P)residual_a_b(P, Qcmd, Xmodel, geom0, gamma), P0, lbB, ubB, opts);
      out.stageB.a = P_star(1:4);
      out.stageB.b = P_star(5:8);
    end

    rB = residual_a_b(P_star, Qcmd, Xmodel, geom0, gamma);
    out.stageB.resnorm = sum(rB.^2);
    out.stageB.rmse = sqrt(out.stageB.resnorm / numel(rB));
    out.stageB.rmse_xyz = rmse_xyz_from_r(rB);
  end
end

function Xmodel = meas_to_model(Xmeas, reg)
  % Xmeas: N×3
  % reg: roll/pitch/yaw deg, t mm, mapping Xmeas ≈ R*Xmodel + t
  % => Xmodel = R'*(Xmeas - t)
  if size(Xmeas,2) ~= 3
    error('Xmeas must be N×3');
  end
  roll = reg.roll; pitch = reg.pitch; yaw = reg.yaw;
  t = reg.t(:);

  cr = cosd(roll);  sr = sind(roll);
  cp = cosd(pitch); sp = sind(pitch);
  cy = cosd(yaw);   sy = sind(yaw);

  Rx = [1, 0, 0; 0, cr, -sr; 0, sr, cr];
  Ry = [cp, 0, sp; 0, 1, 0; -sp, 0, cp];
  Rz = [cy, -sy, 0; sy, cy, 0; 0, 0, 1];
  R = Rz * Ry * Rx;

  N = size(Xmeas,1);
  Xmodel = zeros(N,3);
  for i = 1:N
    xm = Xmeas(i,:)' - t;
    Xmodel(i,:) = (R' * xm)';
  end
end

function r = residual_b_only(b, Qcmd, Xmodel, geom0, gamma)
  % b: offsets (deg) for [q0,q1,q2,(q3)] depending on fixed gamma mode
  N = size(Qcmd,1);
  r = zeros(3*N,1);
  for i = 1:N
    if isempty(gamma)
      Qact = Qcmd(i,:)' + b; % q0..q3
    else
      q0 = Qcmd(i,1) + b(1);
      q1 = Qcmd(i,2) + b(2);
      q2 = Qcmd(i,3) + b(3);
      q3 = gamma - q1 - q2;
      Qact = [q0;q1;q2;q3];
    end
    Xpred = FK_local(Qact, geom0);
    ri = Xpred - Xmodel(i,:)';
    r(3*(i-1)+1:3*i) = ri;
  end
end

function r = residual_a_b(P, Qcmd, Xmodel, geom0, gamma)
  % P: [a; b] where length depends on fixed gamma mode
  N = size(Qcmd,1);
  r = zeros(3*N,1);
  for i = 1:N
    if isempty(gamma)
      a = P(1:4);
      b = P(5:8);
      Qact = a .* Qcmd(i,:)' + b; % q0..q3
    else
      a = P(1:3);
      b = P(4:6);
      q0 = a(1) * Qcmd(i,1) + b(1);
      q1 = a(2) * Qcmd(i,2) + b(2);
      q2 = a(3) * Qcmd(i,3) + b(3);
      q3 = gamma - q1 - q2;
      Qact = [q0;q1;q2;q3];
    end
    Xpred = FK_local(Qact, geom0);
    ri = Xpred - Xmodel(i,:)';
    r(3*(i-1)+1:3*i) = ri;
  end
end

function rmse_xyz = rmse_xyz_from_r(r)
  N = numel(r) / 3;
  R = reshape(r, [3, N]);
  rmse_xyz = sqrt(mean(R.^2, 2));
end

function X = FK_local(Q, geom)
  % FK for yaw + 3 pitch, with elbow-axis offset dX (no spinner/gripper offsets).
  % Angles in degrees.
  q0 = Q(1); q1 = Q(2); q2 = Q(3); q3 = Q(4);

  H  = geom.H;
  L1 = geom.L1;
  L2 = geom.L2;
  L3 = geom.L3;
  dX = geom.dX;

  Gamma = q1 + q2 + q3;
  rr = dX * cosd(q1) + L1 * sind(q1) + L2 * sind(q1 + q2) + L3 * sind(Gamma);
  X = [
        rr * cosd(q0);
        rr * sind(q0);
        H - dX * sind(q1) + L1 * cosd(q1) + L2 * cosd(q1 + q2) + L3 * cosd(Gamma)
      ];
end

