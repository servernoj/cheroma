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
 * @returns {{p: Raw3D}}
 */
const FK_ = ({ q0, q1, q2, q3 }, gamma) => {
  const { L1, L2, L3, H, dX } = config.geom
  gamma = gamma ?? q1 + q2 + q3
  const r = (
    dX * Math.cos(d2r(q1)) +
    L1 * Math.sin(d2r(q1)) +
    L2 * Math.sin(d2r(q1 + q2)) +
    L3 * Math.sin(d2r(gamma))
  )
  const p = [
    r * Math.cos(d2r(q0)),
    r * Math.sin(d2r(q0)),
    H - dX * Math.sin(d2r(q1)) + L1 * Math.cos(d2r(q1)) + L2 * Math.cos(d2r(q1 + q2)) + L3 * Math.cos(d2r(gamma))
  ]
  return { p }
}

/**
 * Forward kinematics helper
 * @param {KinematicsInput} Q
 * @returns {KinematicsOutput}
 */
const FK = (Q) => {
  const { p } = FK_(Q)
  const mapping = ['x', 'y', 'z']
  return mapping.reduce(
    /** @param {*} acc  */
    (acc, label, idx) => {
      acc[label] = p[idx]
      return acc
    },
    {}
  )
}

/**
 * Inverse kinematics
 * @param {KinematicsOutput} args
 * @param {{
 *   tunning: boolean
 *   gamma: number
 * }} [options]
 * @returns {KinematicsInput}
 */
const IK = ({ x, y, z }, options) => {
  const {
    tunning = false,
    gamma = 180
  } = options ?? {}
  const { L1, L2, L3, H, dX } = config.geom
  const q0 = Math.atan2(y, x)
  const r = Math.hypot(x, y)
  const rw = r - L3 * Math.sin(d2r(gamma))
  const zw = z - H - L3 * Math.cos(d2r(gamma))
  // L1p = hypot(L1, dX), alpha = atan2(dX, L1)
  // theta1 = q1 + alpha, theta2 = q2 - alpha
  // Standard 2-link solve for (theta1,theta2), then recover (q1,q2).
  const L1p = Math.hypot(L1, dX)
  const alpha = Math.atan2(dX, L1)
  const D = (rw * rw + zw * zw - L1p * L1p - L2 * L2) / (2 * L1p * L2)
  if (Math.abs(D) > 1) {
    throw new Error('Position unreachable')
  }
  const s = Math.sqrt(1 - D * D)
  const theta2_r = [
    Math.atan2(+s, D),
    Math.atan2(-s, D)
  ]
  const theta1_r = theta2_r.map(
    theta2 => {
      const A = L1p + L2 * Math.cos(theta2)
      const B = L2 * Math.sin(theta2)
      return Math.atan2(A * rw - B * zw, B * rw + A * zw)
    }
  )
  const q1_r = theta1_r.map(theta1 => theta1 - alpha)
  const q2_r = theta2_r.map(theta2 => theta2 + alpha)
  const z_elbow = q1_r.map(
    q1 => H - dX * Math.sin(q1) + L1 * Math.cos(q1)
  )
  const idx = z_elbow[0] > z_elbow[1] ? 0 : 1
  let [q1, q2] = [q1_r[idx], q2_r[idx]]
  if (tunning) {
    const epsilon = 1e-4
    // -- Numerical refinement by Newton method (keep for robustness)
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
  }
  const q3 = d2r(gamma) - q1 - q2
  return {
    q0: r2d(q0),
    q1: r2d(q1),
    q2: r2d(q2),
    q3: r2d(q3),
  }
}

/**
 * @param {KinematicsOutput} P 
 * @returns {ServoPosition}
 */
const IKK = P => K2S(IK(toModel(P)))

export { FK, IK, IKK, K2S, toModel }