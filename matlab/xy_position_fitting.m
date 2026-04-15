function out = xy_position_fitting(D)
% XY_POSITION_FITTING  Fit quadratic mapping from target XY to measured XY.
%
%   out = xy_position_fitting(D)
%
%   D : N×4 matrix — each row is [x_target, y_target, x_measured, y_measured]
%       (paste CSV output from calibration endpoint directly)
%
%   Model (quadratic):
%     xm = cx(1) + cx(2)*x + cx(3)*y + cx(4)*x^2 + cx(5)*x*y + cx(6)*y^2
%     ym = cy(1) + cy(2)*x + cy(3)*y + cy(4)*x^2 + cy(5)*x*y + cy(6)*y^2
%
%   Identity: cx = [0,1,0,0,0,0], cy = [0,0,1,0,0,0].
%
%   Correction is applied by inverting the mapping via Newton's method.

    xt = D(:,1);  yt = D(:,2);
    xm = D(:,3);  ym = D(:,4);
    N = size(D,1);

    % design matrix [1, x, y, x^2, x*y, y^2]
    A = [ones(N,1), xt, yt, xt.^2, xt.*yt, yt.^2];

    % solve: xm = A * cx,  ym = A * cy
    cx = A \ xm;
    cy = A \ ym;

    % residuals
    xm_pred = A * cx;
    ym_pred = A * cy;

    ex_raw = xm - xt;
    ey_raw = ym - yt;
    rx = xm - xm_pred;
    ry = ym - ym_pred;

    rmse_raw = sqrt(mean(ex_raw.^2 + ey_raw.^2));
    rmse_fit = sqrt(mean(rx.^2 + ry.^2));

    fprintf('\n--- XY Position-Space Fitting (quadratic) ---\n');
    fprintf('Samples:        %d\n', N);
    fprintf('Raw RMSE:       %.4f mm  (before correction)\n', rmse_raw);
    fprintf('Fit RMSE:       %.4f mm  (residual after quadratic model)\n', rmse_fit);
    fprintf('cx: [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f]\n', cx);
    fprintf('cy: [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f]\n', cy);

    out.cx = cx(:)';
    out.cy = cy(:)';
    out.rmse_raw = rmse_raw;
    out.rmse_fit = rmse_fit;
    out.errors_raw = [ex_raw, ey_raw];
    out.errors_fit = [rx, ry];

    % JSON snippet for config.json
    fprintf('\nConfig JSON:\n');
    fprintf('  "xyCorrection": {\n');
    fprintf('    "cx": [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f],\n', cx);
    fprintf('    "cy": [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f]\n', cy);
    fprintf('  }\n\n');
end
