function out = z_position_fitting(D)
% Z_POSITION_FITTING  Fit affine Z mapping from calibration data.
%
%   out = z_position_fitting(D)
%
%   D : N×6 matrix — each row is [x_target, y_target, z_target, x_measured, y_measured, z_measured]
%       or N×4 matrix — each row is [x_target, y_target, z_target, z_measured]
%
%   Affine model:
%     zm = cz(1) + cz(2)*x + cz(3)*y + cz(4)*z
%
%   Identity: cz = [0, 0, 0, 1].

    ncols = size(D, 2);
    if ncols == 6
        xt = D(:,1);  yt = D(:,2);  zt = D(:,3);
        zm = D(:,6);
    elseif ncols == 4
        xt = D(:,1);  yt = D(:,2);  zt = D(:,3);
        zm = D(:,4);
    else
        error('Expected N×6 or N×4 matrix, got N×%d', ncols);
    end
    N = size(D,1);

    A = [ones(N,1), xt, yt, zt];

    cz = A \ zm;

    zm_pred = A * cz;

    ez_raw = zm - zt;
    rz = zm - zm_pred;

    rmse_raw = sqrt(mean(ez_raw.^2));
    rmse_fit = sqrt(mean(rz.^2));

    fprintf('\n--- Z Position-Space Fitting (affine) ---\n');
    fprintf('Samples:        %d\n', N);
    fprintf('Raw RMSE:       %.4f mm  (before correction)\n', rmse_raw);
    fprintf('Fit RMSE:       %.4f mm  (residual after affine model)\n', rmse_fit);
    fprintf('cz: [%.6f, %.6f, %.6f, %.6f]\n', cz);

    out.cz = cz(:)';
    out.rmse_raw = rmse_raw;
    out.rmse_fit = rmse_fit;
    out.errors_raw = ez_raw;
    out.errors_fit = rz;

    fprintf('\nConfig JSON:\n');
    fprintf('  "zCorrection": {\n');
    fprintf('    "cz": [%.6f, %.6f, %.6f, %.6f]\n', cz);
    fprintf('  }\n\n');
end
