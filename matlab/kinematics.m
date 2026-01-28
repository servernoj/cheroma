function out = kinematics()

  geom.R = 27;
  geom.La = 95 + 68;
  geom.dU = 0; % x- at q0=0
  geom.dV = -10; % y+ at q0=0
  geom.dX = 20;
  geom.H = 130;
  geom.L1 = 211;
  geom.L2 = 265;
  geom.L3 = 50;
  H = sym('H');
  L1 = sym('L1');
  L2 = sym('L2');
  L3 = sym('L3');
  La = sym('La');
  R = sym('R');
  dU = sym('dU');
  dV = sym('dV');
  dX = sym('dX');
  q0 = sym('q0');
  q1 = sym('q1');
  q2 = sym('q2');
  q3 = sym('q3');
  q4 = sym('q4');

  % FK
  Gamma = q1 + q2 + q3
  r = dX * cos(q1) + L1 * sin(q1) + L2 * sin(q1 + q2) + L3 * sin(Gamma);
  t = [sin(Gamma) * cos(q0); sin(Gamma) * sin(q0); cos(Gamma)];
  v = [-sin(q0); cos(q0); 0];
  u = [cos(q0) * cos(Gamma); sin(q0) * cos(Gamma); -sin(Gamma)];
  Pref = [
          r * cos(q0);
          r * sin(q0);
          H - dX * sin(q1) + L1 * cos(q1) + L2 * cos(q1 + q2) + L3 * cos(Gamma)
          ];
  Pspin = dU * u + dV * v;
  Pecc = R * (cos(q4) * u + sin(q4) * v);
  Delta = Pspin + Pecc + La * t;
  Ptcp = Pref + Delta;

  function Q = IK0(P, Gamma_)
    x = P(1);
    y = P(2);
    z = P(3);
    q0_ = atan2(y, x);
    r = hypot(x, y);
    rw = r - geom.L3 * sin(Gamma_);
    zw = (z - geom.H) - geom.L3 * cos(Gamma_);
    D = (rw ^ 2 + zw ^ 2 - geom.L1 ^ 2 - geom.L2 ^ 2) / (2 * geom.L1 * geom.L2);

    if (abs(D) > 1)
      error('IK0:NoSolution', 'Point unreachable');
    end

    s = sqrt(1 - D ^ 2);
    q2_ = [atan2(+s, D); atan2(-s, D)];
    A = geom.L1 + geom.L2 * cos(q2_);
    B = geom.L2 * sin(q2_);
    q1_ = atan2(A * rw - B * zw, B * rw + A * zw);
    z_elbow = geom.H + geom.L1 * cos(q1_);
    [~, idx] = max(z_elbow);
    q1_ = q1_(idx);
    q2_ = q2_(idx);

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
    Q = [q0_; q1_; q2_; q3_; q4_(q0_)];
  end

  function out = q4_(q0_)
    out = q0_;
  end

  % IK
  function [QQ, found] = IK(P, Gamma_)
    x = P(1);
    y = P(2);
    q0_ = atan2(y, x);
    Q = [q0_; 0; 0; 0; q4_(q0_)];
    eps = 1e-2;
    found = false;
    subsList = {q0, q1, q2, q3, q4, H, L1, L2, L3, La, dX, dU, dV, R};

    for i = 1:100
      delta = double(subs( ...
        Delta, ...
        subsList, ...
        {Q(1), Q(2), Q(3), Q(4), Q(5), geom.H, geom.L1, geom.L2, geom.L3, geom.La, geom.dX, geom.dU, geom.dV, geom.R} ...
      ));

      try
        Q = IK0(P - delta, Gamma_);
      catch ME

        if strcmp(ME.identifier, 'IK0:NoSolution')
          Q = [];
          warning(ME.identifier, '%s', ME.message);
          break;
        end

      end

      P_ = double(subs( ...
        Ptcp, ...
        subsList, ...
        {Q(1), Q(2), Q(3), Q(4), Q(5), geom.H, geom.L1, geom.L2, geom.L3, geom.La, geom.dX, geom.dU, geom.dV, geom.R} ...
      ));

      if (norm(P - P_) < eps)
        found = true;
        break;
      end

    end

    if (found)
      QQ = toDegrees('radians', Q);
    else
      QQ = [];
    end

  end

  out.IK = @IK;
  out.geom = geom;

end
