function out = xy_position_fitting(D)
% XY_POSITION_FITTING  Fit affine mapping from target XY to measured XY.
%
%   out = xy_position_fitting(D)
%
%   D : N×4 matrix — each row is [x_target, y_target, x_measured, y_measured]
%
%   Affine model:
%     xm = cx(1) + cx(2)*x + cx(3)*y
%     ym = cy(1) + cy(2)*x + cy(3)*y
%
%   Identity: cx = [0,1,0], cy = [0,0,1].

    xt = D(:,1);  yt = D(:,2);
    xm = D(:,3);  ym = D(:,4);
    N = size(D,1);

    A = [ones(N,1), xt, yt];

    cx = A \ xm;
    cy = A \ ym;

    xm_pred = A * cx;
    ym_pred = A * cy;

    ex_raw = xm - xt;
    ey_raw = ym - yt;
    rx = xm - xm_pred;
    ry = ym - ym_pred;

    rmse_raw = sqrt(mean(ex_raw.^2 + ey_raw.^2));
    rmse_fit = sqrt(mean(rx.^2 + ry.^2));

    fprintf('\n--- XY Position-Space Fitting (affine) ---\n');
    fprintf('Samples:        %d\n', N);
    fprintf('Raw RMSE:       %.4f mm  (before correction)\n', rmse_raw);
    fprintf('Fit RMSE:       %.4f mm  (residual after affine model)\n', rmse_fit);
    fprintf('cx: [%.6f, %.6f, %.6f]\n', cx);
    fprintf('cy: [%.6f, %.6f, %.6f]\n', cy);

    out.cx = cx(:)';
    out.cy = cy(:)';
    out.rmse_raw = rmse_raw;
    out.rmse_fit = rmse_fit;
    out.errors_raw = [ex_raw, ey_raw];
    out.errors_fit = [rx, ry];

    fprintf('\nConfig JSON:\n');
    fprintf('  "xyCorrection": {\n');
    fprintf('    "cx": [%.6f, %.6f, %.6f],\n', cx);
    fprintf('    "cy": [%.6f, %.6f, %.6f]\n', cy);
    fprintf('  }\n\n');
end
