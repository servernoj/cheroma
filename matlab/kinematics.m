function out = kinematics()

  geom.R = 15;
  geom.La = 45;
  geom.dU = 10;
  geom.dV = 5;
  geom.H = 130;
  geom.L1 = 211;
  geom.L2 = 265;
  geom.L3 = 100;
  geom.dX = 20;
  H = sym('H');
  L1 = sym('L1');
  L2 = sym('L2');
  L3 = sym('L3');
  La = sym('La');
  R = sym('R');
  dU = sym('dU');
  dV = sym('dV');
  dX = sym('dX');
  Gamma = sym('Gamma');
  q0 = sym('q0');
  q1 = sym('q1');
  q2 = sym('q2');
  q3 = sym('q3');
  q4 = sym('q4');
  q5 = sym('q5');

  % FK
  r = dX * cos(q1) + L1 * sin(q1) + L2 * sin(q1 + q2) + L3 * sin(q1 + q2 + q3);
  t = [sin(Gamma) * cos(q0); sin(Gamma) * sin(q0); cos(Gamma)];
  v = [-sin(q0); cos(q0); 0];
  u = [cos(q0) * cos(Gamma); sin(q0) * cos(Gamma); -sin(Gamma)];
  Pref = [r * cos(q0) r * sin(q0) -dX * sin(q1) + L1 * cos(q1) + L2 * cos(q1 + q2) + L3 * cos(q1 + q2 + q3)];
  Pspin = dU * u + dV * v;
  Pecc = R * (cos(q4) * u + sin(q4) * v);
  Delta = Pspin + Pecc + La * t;
  P = Pref + Delta;

  function Q = IK0(P, Gamma_)
    x = P(1);
    y = P(2);
    z = P(3);
    q0 = atan2(y, x);
    rw = hypot(x, y);
    zw = (z - geom.H) + geom.L3;
    D = (rw ^ 2 + zw ^ 2 - geom.L1 ^ 2 - geom.L2 ^ 2) / (2 * geom.L1 * geom.L2);
    s = sqrt(1 - D ^ 2);
    q2 = [atan2(+s, D); atan2(-s, D)];
    A = geom.L1 + geom.L2 * cos(q2);
    B = geom.L2 * sin(q2);
    q1 = atan2(A * rw - B * zw, B * rw + A * zw);
    z_elbow = geom.H + geom.L1 * cos(q1);
    [~, idx] = max(z_elbow);
    q3 = Gamma_ - q1 - q2;
    Q = [q0; q1(idx); q2(idx); q3(idx)];
  end

  % IK
  function Q = IK(P, Gamma_)
    x = P(1);
    y = P(2);
    z = P(3);
    Q = [atan2(y, x), 0, 0, 0];

    for i = 1:1
      q0_ = Q(1);
      q4_ = -q0_;
      delta = double(subs(Delta, {q0, q4, Gamma, R, dU, dV, La}, {q0_, q4_, Gamma_, geom.R, geom.dU, geom.dV, geom.La}));
      Q = IK0(P - delta, Gamma_);
    end

    % q0 = Q(1);
    % q1 = Q(2);
    % q2 = Q(3);
    % q3 = Q(4);
    % q4 = -q0;

  end

  out.IK = @IK;
  out.geom = geom;

end
