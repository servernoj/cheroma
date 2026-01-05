% calibrate_lm_symbolic.m
%
% Nonlinear least-squares (Levenberg–Marquardt) fit for servo calibration params P
% using an "ANALYTICAL" Jacobian generated via the Octave symbolic package (SymPy).
%
% This file is meant as a clear reference implementation:
% - It uses symbolic differentiation to compute d(FK)/d(theta)
% - It then applies the chain rule through theta(u,P) to get d r / d P
%
% Assumptions:
% - Data: N samples (u -> x) with u=[u1..u4], x=[X,Y,Z] in base frame (mm)
% - Servo mapping: theta_j = s_j*u_j + o_j
% - P = [s1 s2 s3 s4 o1 o2 o3 o4]^T
% - FK is the same simple yaw + planar 3R chain as in calibrate_lm_numeric.m
%   (edit FK here to match your arm; Jacobian will update automatically).
%
% Usage:
%   octave -q docs/IK/calibrate_lm_symbolic.m path/to/data.csv
%
% Requires:
%   pkg install -forge symbolic   (once)
%   pkg load symbolic
%   SymPy available (you said SymPy v1.14)
%
% Output:
% - Prints P* and RMS error
% - Saves docs/IK/P_est_symbolic.mat (P_est, stats)

function calibrate_lm_symbolic_main()
  args = argv();
  if numel(args) < 1
    fprintf("Usage: octave -q docs/IK/calibrate_lm_symbolic.m path/to/data.csv\n");
    fprintf("CSV format: u1,u2,u3,u4,X,Y,Z (N rows)\n");
    error("Missing CSV path.");
  end

  pkg load symbolic

  data_path = args{1};
  data = read_csv_matrix(data_path);
  assert(size(data,2) == 7, "Expected 7 columns: u1,u2,u3,u4,X,Y,Z");

  U = data(:, 1:4);     % N x 4
  Xmeas = data(:, 5:7); % N x 3

  geom = default_geom();

  % Initial guess P0.
  P0 = [1;1;1;1;  0;0;0;0];

  opts = struct();
  opts.max_iter = 80;
  opts.tol_step = 1e-10;
  opts.tol_cost = 1e-12;
  opts.lambda0 = 1e-3;
  opts.lambda_up = 10.0;
  opts.lambda_down = 0.3;

  % Build FK and d(FK)/d(theta) function handles from symbolic expressions.
  [fk_fn, dxdtheta_fn] = build_symbolic_fk_and_jacobian();

  [P_est, stats] = lm_fit_analytic(P0, U, Xmeas, geom, fk_fn, dxdtheta_fn, opts);

  fprintf("\n=== Estimated P (symbolic/analytic Jacobian) ===\n");
  fprintf("s = [%.12g %.12g %.12g %.12g]\n", P_est(1),P_est(2),P_est(3),P_est(4));
  fprintf("o = [%.12g %.12g %.12g %.12g]\n", P_est(5),P_est(6),P_est(7),P_est(8));
  fprintf("RMS (mm): %.6f\n", stats.rms_mm);
  fprintf("iters: %d\n", stats.iters);

  out_path = fullfile(fileparts(mfilename("fullpath")), "P_est_symbolic.mat");
  save(out_path, "P_est", "stats");
  fprintf("Saved: %s\n", out_path);
end


function [P, stats] = lm_fit_analytic(P0, U, Xmeas, geom, fk_fn, dxdtheta_fn, opts)
  P = P0(:);
  lambda = opts.lambda0;

  [r, cost, J] = residual_and_jacobian(P, U, Xmeas, geom, fk_fn, dxdtheta_fn);
  cost_prev = cost;

  for iter = 1:opts.max_iter
    A = (J' * J) + lambda * eye(numel(P));
    g = (J' * r);
    dP = -A \ g;

    if norm(dP) <= opts.tol_step * (norm(P) + opts.tol_step)
      break;
    end

    P_try = P + dP;
    [r_try, cost_try, J_try] = residual_and_jacobian(P_try, U, Xmeas, geom, fk_fn, dxdtheta_fn);

    if cost_try < cost
      P = P_try;
      r = r_try;
      J = J_try;
      cost_prev = cost;
      cost = cost_try;
      lambda = max(lambda * opts.lambda_down, 1e-12);

      if abs(cost_prev - cost) <= opts.tol_cost * (1 + cost)
        break;
      end
    else
      lambda = lambda * opts.lambda_up;
    end
  end

  N = size(U,1);
  stats = struct();
  stats.iters = iter;
  stats.cost = cost;
  stats.rms_mm = sqrt(cost / N);
end


function [r, cost, J] = residual_and_jacobian(P, U, Xmeas, geom, fk_fn, dxdtheta_fn)
  P = P(:);
  s = P(1:4);
  o = P(5:8);

  N = size(U,1);
  r = zeros(3*N, 1);
  J = zeros(3*N, 8);

  L2 = geom.L2; L3 = geom.L3; L4 = geom.L4; z0 = geom.z0;

  for i = 1:N
    u = U(i,:).';             % 4x1
    x_meas = Xmeas(i,:).';    % 3x1

    theta = s .* u + o;       % 4x1

    % FK (numeric)
    x_hat = fk_fn(theta(1),theta(2),theta(3),theta(4), L2,L3,L4,z0);
    x_hat = double(x_hat(:));

    ri = x_hat - x_meas;
    r(3*(i-1)+1 : 3*i) = ri;

    % d(FK)/d(theta) (3x4)
    dxdtheta = dxdtheta_fn(theta(1),theta(2),theta(3),theta(4), L2,L3,L4,z0);
    dxdtheta = double(dxdtheta);

    % Chain rule: theta = diag(u)*s + I*o
    % dtheta/dP = [diag(u)  I]
    dtheta_dP = [diag(u), eye(4)];

    Ji = dxdtheta * dtheta_dP; % 3x8
    J(3*(i-1)+1 : 3*i, :) = Ji;
  end

  cost = sum(r.^2);
end


function [fk_fn, dxdtheta_fn] = build_symbolic_fk_and_jacobian()
  % Build symbolic FK model and its Jacobian w.r.t. theta = [t1..t4].
  %
  % Edit the symbolic FK expressions here to match your real robot.
  % The rest of the LM code will automatically use the updated Jacobian.

  syms t1 t2 t3 t4 real
  syms L2 L3 L4 z0 real

  a2 = t2;
  a3 = t2 + t3;
  a4 = t2 + t3 + t4;

  r = L2*cos(a2) + L3*cos(a3) + L4*cos(a4);
  z = z0 + L2*sin(a2) + L3*sin(a3) + L4*sin(a4);

  X = r*cos(t1);
  Y = r*sin(t1);

  x_sym = [X; Y; z];
  dxdtheta_sym = jacobian(x_sym, [t1 t2 t3 t4]); % 3x4

  % Compile to numeric function handles
  % NOTE: function_handle returns handles that accept scalars and return sym -> convert to double().
  fk_fn = function_handle(x_sym, {t1,t2,t3,t4, L2,L3,L4,z0});
  dxdtheta_fn = function_handle(dxdtheta_sym, {t1,t2,t3,t4, L2,L3,L4,z0});
end


function geom = default_geom()
  geom = struct();
  geom.L2 = 90;   % mm
  geom.L3 = 90;   % mm
  geom.L4 = 60;   % mm
  geom.z0 = 0;    % mm
end


function M = read_csv_matrix(path)
  try
    M = readmatrix(path);
  catch
    M = dlmread(path, ",");
  end
end


% Execute when run as a script
calibrate_lm_symbolic_main();

