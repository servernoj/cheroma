function out = z_position_fitting(D)
% Z_POSITION_FITTING  Fit quadratic Z error model from calibration data.
%
%   out = z_position_fitting(D)
%
%   D : N×6 matrix — each row is [x_target, y_target, z_target, x_measured, y_measured, z_measured]
%       or N×4 matrix — each row is [x_target, y_target, z_target, z_measured]
%
%   Model (quadratic):
%     zm = cz(1) + cz(2)*x + cz(3)*y + cz(4)*z + cz(5)*x^2 + cz(6)*y^2
%          + cz(7)*z^2 + cz(8)*x*y + cz(9)*x*z + cz(10)*y*z
%
%   Identity: cz = [0,0,0,1,0,0,0,0,0,0].

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

    % design matrix [1, x, y, z, x^2, y^2, z^2, x*y, x*z, y*z]
    A = [ones(N,1), xt, yt, zt, xt.^2, yt.^2, zt.^2, xt.*yt, xt.*zt, yt.*zt];

    cz = A \ zm;

    % residuals
    zm_pred = A * cz;
    ez_raw = zm - zt;
    rz = zm - zm_pred;

    rmse_raw = sqrt(mean(ez_raw.^2));
    rmse_fit = sqrt(mean(rz.^2));

    fprintf('\n--- Z Position-Space Fitting (quadratic) ---\n');
    fprintf('Samples:        %d\n', N);
    fprintf('Raw RMSE:       %.4f mm  (before correction)\n', rmse_raw);
    fprintf('Fit RMSE:       %.4f mm  (residual after quadratic model)\n', rmse_fit);
    fprintf('cz: [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f]\n', cz);

    out.cz = cz(:)';
    out.rmse_raw = rmse_raw;
    out.rmse_fit = rmse_fit;
    out.errors_raw = ez_raw;
    out.errors_fit = rz;

    % JSON snippet for config.json
    fprintf('\nConfig JSON:\n');
    fprintf('  "zCorrection": {\n');
    fprintf('    "cz": [%.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f, %.6f]\n', cz);
    fprintf('  }\n\n');
end
