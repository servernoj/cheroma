function out = kinematics()

  geom.H = 130;
  geom.L1 = 211;
  geom.L2 = 265;
  geom.L3 = 50;
  geom.dX = 20;
  H = sym('H');
  L1 = sym('L1');
  L2 = sym('L2');
  L3 = sym('L3');
  dX = sym('dX');
  q0 = sym('q0');
  q1 = sym('q1');
  q2 = sym('q2');
  q3 = sym('q3');

  % FK
  Gamma = q1 + q2 + q3;
  r = dX * cos(q1) + L1 * sin(q1) + L2 * sin(q1 + q2) + L3 * sin(Gamma);
  Ptcp = [
          r * cos(q0);
          r * sin(q0);
          H - dX * sin(q1) + L1 * cos(q1) + L2 * cos(q1 + q2) + L3 * cos(Gamma)
          ];

  function P = FK(Q)
    % Q: 4 x 1
    % P: 3 x 1
    P = double( ...
      subs(Ptcp, {q0, q1, q2, q3, H, L1, L2, L3, dX}, {Q(1), Q(2), Q(3), Q(4), geom.H, geom.L1, geom.L2, geom.L3, geom.dX}) ...
    );
  end

  % IK
  function Q = IK(P, Gamma_)
    x = P(1);
    y = P(2);
    z = P(3);
    q0_ = atan2(y, x);
    r = hypot(x, y);
    rw = r - geom.L3 * sin(Gamma_);
    zw = (z - geom.H) - geom.L3 * cos(Gamma_);

    % --- Stage 1 (analytic seed), but INCLUDING dX ---
    %
    % The shoulder→elbow vector at q1=0 is [dX; L1] in the (r,z) plane.
    % This is equivalent to a link of length L1p rotated by an offset alpha:
    %   L1p = hypot(L1, dX),  alpha = atan2(dX, L1)
    % If we define:
    %   theta1 = q1 + alpha
    %   theta2 = q2 - alpha
    % then the wrist-point equations become the standard 2-link form:
    %   rw = L1p*sin(theta1) + L2*sin(theta1+theta2)
    %   zw = L1p*cos(theta1) + L2*cos(theta1+theta2)
    % We can solve analytically for (theta1,theta2) and then recover (q1,q2).
    L1p = hypot(geom.L1, geom.dX);
    alpha = atan2(geom.dX, geom.L1);

    D = (rw ^ 2 + zw ^ 2 - L1p ^ 2 - geom.L2 ^ 2) / (2 * L1p * geom.L2);

    if (abs(D) > 1)
      error('IK:NoSolution', 'Point unreachable (D=%g)', D);
    end

    s = sqrt(1 - D ^ 2);
    theta2 = [atan2(+s, D); atan2(-s, D)];
    A = L1p + geom.L2 * cos(theta2);
    B = geom.L2 * sin(theta2);
    theta1 = atan2(A * rw - B * zw, B * rw + A * zw);

    q1_c = theta1 - alpha;
    q2_c = theta2 + alpha;

    % Choose elbow-up branch by higher elbow Z in the REAL dX model.
    z_elbow = geom.H - geom.dX * sin(q1_c) + geom.L1 * cos(q1_c);
    [~, idx] = max(z_elbow);
    q1_ = q1_c(idx);
    q2_ = q2_c(idx);

    % numerical tunning
    for i = 1:100
      fr = geom.dX * cos(q1_) + geom.L1 * sin(q1_) + geom.L2 * sin(q1_ + q2_) - rw;
      fz = -geom.dX * sin(q1_) + geom.L1 * cos(q1_) + geom.L2 * cos(q1_ + q2_) - zw;
      err = hypot(fr, fz);

      if (err < 1e-4)
        break;
      end

      J11 = -geom.dX * sin(q1_) + geom.L1 * cos(q1_) + geom.L2 * cos(q1_ + q2_);
      J12 = geom.L2 * cos(q1_ + q2_);
      J21 = -geom.dX * cos(q1_) - geom.L1 * sin(q1_) - geom.L2 * sin(q1_ + q2_);
      J22 = -geom.L2 * sin(q1_ + q2_);
      det = J11 * J22 - J12 * J21;
      q1_ = q1_ - (J22 * fr - J12 * fz) / det;
      q2_ = q2_ - (-J21 * fr + J11 * fz) / det;
    end

    q3_ = Gamma_ - q1_ - q2_;
    Q = [q0_; q1_; q2_; q3_];
  end

  out.IK = @IK;
  out.FK = @FK;

end
