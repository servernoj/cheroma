% calibrate_lm_numeric.m
%
% Nonlinear least-squares (Levenberg–Marquardt) fit for servo calibration params P
% using a NUMERICAL (finite-difference) Jacobian.
%
% Assumptions:
% - You have N samples of (u -> x) where:
%   u = [u1 u2 u3 u4] are the commanded servo values you sent
%   x = [X  Y  Z ] is the measured end-effector position in the BASE frame (mm)
% - You have a forward kinematics function FK(theta) for your robot geometry.
% - Servo command -> physical joint angle mapping is affine:
%     theta_j = s_j * u_j + o_j
%   P = [s1 s2 s3 s4 o1 o2 o3 o4]^T  (8 parameters)
%
% Usage:
%   octave -q docs/IK/calibrate_lm_numeric.m path/to/data.csv
%
% CSV format (one row per sample):
%   u1,u2,u3,u4,X,Y,Z
%
% Output:
% - Prints P* and RMS error
% - Saves docs/IK/P_est_numeric.mat (P_est, stats)
%
% NOTE:
% - Edit `geom = default_geom();` and `fk_planar_4dof(...)` to match your arm.
% - This file avoids the symbolic package entirely.

function calibrate_lm_numeric_main()
  args = argv();
  if numel(args) < 1
    fprintf("Usage: octave -q docs/IK/calibrate_lm_numeric.m path/to/data.csv\n");
    fprintf("CSV format: u1,u2,u3,u4,X,Y,Z (N rows)\n");
    error("Missing CSV path.");
  end

  data_path = args{1};
  data = read_csv_matrix(data_path);
  assert(size(data,2) == 7, "Expected 7 columns: u1,u2,u3,u4,X,Y,Z");

  U = data(:, 1:4);     % N x 4
  Xmeas = data(:, 5:7); % N x 3

  geom = default_geom();

  % Initial guess P0.
  % - If your u's are already in radians, keep s=1.
  % - If u is degrees but FK expects radians, initialize s = pi/180 (or set FK to degrees).
  P0 = [1;1;1;1;  0;0;0;0];

  opts = struct();
  opts.max_iter = 80;
  opts.tol_step = 1e-10;
  opts.tol_cost = 1e-12;
  opts.lambda0 = 1e-3;
  opts.lambda_up = 10.0;
  opts.lambda_down = 0.3;
  opts.eps_fd = 1e-6; % finite-difference base step

  [P_est, stats] = lm_fit_numeric(P0, U, Xmeas, geom, opts);

  fprintf("\n=== Estimated P (numeric Jacobian) ===\n");
  fprintf("s = [%.12g %.12g %.12g %.12g]\n", P_est(1),P_est(2),P_est(3),P_est(4));
  fprintf("o = [%.12g %.12g %.12g %.12g]\n", P_est(5),P_est(6),P_est(7),P_est(8));
  fprintf("RMS (mm): %.6f\n", stats.rms_mm);
  fprintf("iters: %d\n", stats.iters);

  out_path = fullfile(fileparts(mfilename("fullpath")), "P_est_numeric.mat");
  save(out_path, "P_est", "stats");
  fprintf("Saved: %s\n", out_path);
end


function [P, stats] = lm_fit_numeric(P0, U, Xmeas, geom, opts)
  P = P0(:);
  lambda = opts.lambda0;

  [r, cost] = residual_vector(P, U, Xmeas, geom);
  cost_prev = cost;

  for iter = 1:opts.max_iter
    % Numerical Jacobian J = d r / d P, size (3N x 8)
    J = jacobian_fd(P, U, Xmeas, geom, opts.eps_fd);

    A = (J' * J) + lambda * eye(numel(P));
    g = (J' * r);

    % Solve for step
    dP = -A \ g;

    if norm(dP) <= opts.tol_step * (norm(P) + opts.tol_step)
      break;
    end

    % Candidate step
    P_try = P + dP;
    [r_try, cost_try] = residual_vector(P_try, U, Xmeas, geom);

    if cost_try < cost
      % Accept
      P = P_try;
      r = r_try;
      cost_prev = cost;
      cost = cost_try;
      lambda = max(lambda * opts.lambda_down, 1e-12);

      if abs(cost_prev - cost) <= opts.tol_cost * (1 + cost)
        break;
      end
    else
      % Reject
      lambda = lambda * opts.lambda_up;
    end
  end

  N = size(U,1);
  stats = struct();
  stats.iters = iter;
  stats.cost = cost;
  stats.rms_mm = sqrt(cost / N); % because cost = sum_i ||r_i||^2
end


function J = jacobian_fd(P, U, Xmeas, geom, eps_base)
  P = P(:);
  [r0, ~] = residual_vector(P, U, Xmeas, geom);
  m = numel(r0);
  n = numel(P);
  J = zeros(m, n);

  for k = 1:n
    step = eps_base * max(1.0, abs(P(k)));
    Pk = P;
    Pk(k) = Pk(k) + step;
    [rk, ~] = residual_vector(Pk, U, Xmeas, geom);
    J(:,k) = (rk - r0) / step;
  end
end


function [r, cost] = residual_vector(P, U, Xmeas, geom)
  N = size(U,1);
  r = zeros(3*N, 1);

  for i = 1:N
    u = U(i,:).';
    x_meas = Xmeas(i,:).';

    theta = theta_from_servo(u, P);
    x_hat = fk_planar_4dof(theta, geom);

    ri = x_hat - x_meas;
    r(3*(i-1)+1 : 3*i) = ri;
  end

  cost = sum(r.^2);
end


function theta = theta_from_servo(u, P)
  s = P(1:4);
  o = P(5:8);
  theta = s .* u + o;
end


function geom = default_geom()
  % Edit these values to match your robot geometry.
  %
  % Model used in fk_planar_4dof:
  % - theta1: base yaw about Z
  % - theta2/3/4: planar chain in XZ plane (parallel axes), with link lengths L2 L3 L4
  % - z0: base height offset added to Z
  geom = struct();
  geom.L2 = 90;   % mm
  geom.L3 = 90;   % mm
  geom.L4 = 60;   % mm (effective wrist->TCP length)
  geom.z0 = 0;    % mm (raise/lower shoulder plane)
end


function x = fk_planar_4dof(theta, geom)
  % Simple 4-DOF FK:
  % - yaw (theta1) rotates the planar reach r into (X,Y)
  % - shoulder/elbow/wrist (theta2..theta4) are a planar 3R chain producing (r, z)
  %
  % NOTE: Replace this with your real FK if you already have one.
  t1 = theta(1); t2 = theta(2); t3 = theta(3); t4 = theta(4);
  L2 = geom.L2; L3 = geom.L3; L4 = geom.L4; z0 = geom.z0;

  a2 = t2;
  a3 = t2 + t3;
  a4 = t2 + t3 + t4;

  r = L2*cos(a2) + L3*cos(a3) + L4*cos(a4);
  z = z0 + L2*sin(a2) + L3*sin(a3) + L4*sin(a4);

  X = r*cos(t1);
  Y = r*sin(t1);

  x = [X; Y; z];
end


function M = read_csv_matrix(path)
  % Robust CSV reader for Octave.
  try
    M = readmatrix(path);
  catch
    M = dlmread(path, ",");
  end
end


% Execute when run as a script
calibrate_lm_numeric_main();

