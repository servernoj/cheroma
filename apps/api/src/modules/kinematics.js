import { Matrix } from 'ml-matrix'
import { cosd, sind, rotationMatrix, d2r, r2d } from '@/modules/utils.js'
import { subscribe } from '@/modules/config.js'

let geom
let fitting
let k2s

subscribe(config => {
  geom = config.geom
  fitting = config.fitting
  k2s = Object.entries(config.servos).reduce(
    (acc, [servoName, { kinematics }]) => {
      acc[kinematics] = servoName
      return acc
    },
    {}
  )
}, { immediate: true })

/**
 * @param {KinematicsOutput} P 
 * @returns {KinematicsOutput}
 */
const toModel = P => {
  const { roll, pitch, yaw, t } = fitting
  const R = rotationMatrix(roll, pitch, yaw)
  const pVec = Matrix.columnVector([P.x, P.y, P.z])
  const tVec = Matrix.columnVector(t)
  const diff = Matrix.subtract(pVec, tVec)
  const P_ = R.transpose().mmul(diff)
  return {
    x: P_.get(0, 0),
    y: P_.get(1, 0),
    z: P_.get(2, 0)
  }
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


/**
 * Forward kinematics helper
 * @param {KinematicsInput} args
 * @param {number} [gamma]
 * @returns {{p: Raw3D}}
 */
const FK_ = ({ q0, q1, q2, q3 }, gamma) => {
  const { L1, L2, L3, H, dX } = geom
  gamma = gamma ?? q1 + q2 + q3
  const r = (
    dX * cosd(q1) +
    L1 * sind(q1) +
    L2 * sind(q1 + q2) +
    L3 * sind(gamma)
  )
  const p = [
    r * cosd(q0),
    r * sind(q0),
    H - dX * sind(q1) + L1 * cosd(q1) + L2 * cosd(q1 + q2) + L3 * cosd(gamma)
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
  const { L1, L2, L3, H, dX } = geom
  const q0 = Math.atan2(y, x)
  const r = Math.hypot(x, y)
  const rw = r - L3 * sind(gamma)
  const zw = z - H - L3 * cosd(gamma)
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