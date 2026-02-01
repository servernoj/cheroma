import config from '@/config.json' with {type: 'json'}
import { mMult, mTrans, mOp } from '@/modules/utils.js'

const k2s = Object.entries(config.servos).reduce(
  (acc, [servoName, { kinematics }]) => {
    acc[kinematics] = servoName
    return acc
  },
  {}
)

/**
 * @param {KinematicsOutput} P 
 * @returns {KinematicsOutput}
 */
const toModel = P => {
  const { roll, pitch, yaw, t } = config.fitting
  const cr = Math.cos(d2r(roll))
  const sr = Math.sin(d2r(roll))
  const cp = Math.cos(d2r(pitch))
  const sp = Math.sin(d2r(pitch))
  const cy = Math.cos(d2r(yaw))
  const sy = Math.sin(d2r(yaw))
  const Rx = [[1, 0, 0], [0, cr, -sr], [0, sr, cr]]
  const Ry = [[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]]
  const Rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]
  const R = mMult(Rz, mMult(Ry, Rx))
  const P_ =
    mMult(
      mTrans(R),
      mTrans(
        mOp(
          [[P.x, P.y, P.z]],
          [t],
          (a, b) => a - b
        )
      )
    )
  return ['x', 'y', 'z'].reduce(
    /** * @param {*} acc */
    (acc, key, idx) => {
      acc[key] = P_[idx][0]
      return acc
    },
    {}
  )
}

/**
 * @param {KinematicsInput} K 
 * @returns {ServoPosition}
 */
const K2S = K => Object.entries(K).reduce(
  /** @param {*} acc */
  (acc, [k, v]) => ({ ...acc, [k2s[k]]: v }),
  {}
)

const r2d = r => r * 180 / Math.PI
const d2r = d => d * Math.PI / 180

/**
 * Forward kinematics helper
 * @param {KinematicsInput} args
 * @param {number} [gamma]
 * @returns {{p: Raw3D, delta: Raw3D}}
 */
const FK_ = ({ q0, q1, q2, q3, q4 }, gamma) => {
  const { L1, L2, L3, H, dX, dU, dV, La, R } = config.geom
  gamma = gamma ?? q1 + q2 + q3
  const r = (
    dX * Math.cos(d2r(q1)) +
    L1 * Math.sin(d2r(q1)) +
    L2 * Math.sin(d2r(q1 + q2)) +
    L3 * Math.sin(d2r(gamma))
  )
  const t = [
    Math.sin(d2r(gamma)) * Math.cos(d2r(q0)),
    Math.sin(d2r(gamma)) * Math.sin(d2r(q0)),
    Math.cos(d2r(gamma))
  ]
  const v = [
    -Math.sin(d2r(q0)),
    Math.cos(d2r(q0)),
    0
  ]
  const u = [
    Math.cos(d2r(q0)) * Math.cos(d2r(gamma)),
    Math.sin(d2r(q0)) * Math.cos(d2r(gamma)),
    -Math.sin(d2r(gamma))
  ]
  const p = [
    r * Math.cos(d2r(q0)),
    r * Math.sin(d2r(q0)),
    H - dX * Math.sin(d2r(q1)) + L1 * Math.cos(d2r(q1)) + L2 * Math.cos(d2r(q1 + q2)) + L3 * Math.cos(d2r(gamma))
  ]
  const delta = Array(3).fill().map(
    (_, idx) => {
      const spin = dU * u[idx] + dV * v[idx]
      const ecc = R * (Math.cos(d2r(q4)) * u[idx] + Math.sin(d2r(q4)) * v[idx])
      const up = La * t[idx]
      return spin + ecc + up
    }
  )
  return { p, delta }
}

/**
 * Forward kinematics helper
 * @param {KinematicsInput} Q
 * @returns {KinematicsOutput}
 */
const FK = (Q) => {
  const { p, delta } = FK_(Q)
  const mapping = ['x', 'y', 'z']
  return mapping.reduce(
    /** @param {*} acc  */
    (acc, label, idx) => {
      acc[label] = p[idx] + delta[idx]
      return acc
    },
    {}
  )
}

const q4 = q0 => q0


/**
 * Inverse kinematics helper
 * @param {KinematicsOutput} args
 * @param {number} gamma
 * @returns {KinematicsInput}
 */
const IK_ = ({ x, y, z }, gamma) => {
  const { L1, L2, L3, H, dX } = config.geom
  const q0 = Math.atan2(y, x)
  const r = Math.hypot(x, y)
  const rw = r - L3 * Math.sin(d2r(gamma))
  const zw = z - H - L3 * Math.cos(d2r(gamma))
  // -- Initial guess assuming dX = 0
  const D = (rw * rw + zw * zw - L1 * L1 - L2 * L2) / (2 * L1 * L2)
  if (Math.abs(D) > 1) {
    throw new Error('Position unreachable')
  }
  const s = Math.sqrt(1 - D * D)
  const q2_r = [
    Math.atan2(+s, D),
    Math.atan2(-s, D)
  ]
  const q1_r = q2_r.map(
    q2 => {
      const A = L1 + L2 * Math.cos(q2)
      const B = L2 * Math.sin(q2)
      return Math.atan2(A * rw - B * zw, B * rw + A * zw)
    }
  )
  const z_elbow = q1_r.map(
    q1 => H + L1 * Math.cos(q1)
  )
  const idx = z_elbow[0] > z_elbow[1] ? 0 : 1
  let [q1, q2] = [q1_r[idx], q2_r[idx]]
  const epsilon = 1e-4
  // -- Numerical solution by Newton method for actual dX
  for (let i = 0; i < 100; i++) {
    const fr = dX * Math.cos(q1) + L1 * Math.sin(q1) + L2 * Math.sin(q1 + q2) - rw
    const fz = -dX * Math.sin(q1) + L1 * Math.cos(q1) + L2 * Math.cos(q1 + q2) - zw
    const error = Math.hypot(fr, fz)
    if (error < epsilon) {
      break
    }
    // Jacobian J = df/d[q1,q2]
    const J11 = -dX * Math.sin(q1) + L1 * Math.cos(q1) + L2 * Math.cos(q1 + q2)
    const J12 = L2 * Math.cos(q1 + q2)
    const J21 = -dX * Math.cos(q1) - L1 * Math.sin(q1) - L2 * Math.sin(q1 + q2)
    const J22 = -L2 * Math.sin(q1 + q2)
    const det = J11 * J22 - J12 * J21
    q1 += - (J22 * fr - J12 * fz) / det
    q2 += - (-J21 * fr + J11 * fz) / det
  }
  const q3 = d2r(gamma) - q1 - q2
  return {
    q0: r2d(q0),
    q1: r2d(q1),
    q2: r2d(q2),
    q3: r2d(q3),
    q4: r2d(q4(q0))
  }
}

/**
 * Inverse kinematics
 * @param {KinematicsOutput} args
 * @param {number} [gamma]
 * @returns {KinematicsInput}
 */
const IK = ({ x, y, z }, gamma = 180) => {
  const q0 = r2d(Math.atan2(y, x))
  let Q = { q0, q1: 0, q2: 0, q3: 0, q4: q4(q0) }
  let found = false
  for (let i = 0; i < 100; i++) {
    const { delta } = FK_(Q, gamma)
    Q = IK_({
      x: x - delta[0],
      y: y - delta[1],
      z: z - delta[2]
    }, gamma)
    const P = FK(Q)
    const error = Math.hypot(P.x - x, P.y - y, P.z - z)
    if (error < 1e-2) {
      found = true
      break
    }
  }
  if (!found) {
    console.warn('Solution not found')
  }
  return Q
}

export { FK, IK, K2S, toModel }