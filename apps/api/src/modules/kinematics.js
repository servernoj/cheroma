import config from '@/config.json' with {type: 'json'}

/**
 * @type {{[name in SegmentName]: number}}
 */
// @ts-ignore
const L = Object.entries(config.segments).reduce(
  (acc, [segmentName, segmentData]) => {
    acc[segmentName] = segmentData.length
    return acc
  },
  {}
)

const k2s = Object.entries(config.servos).reduce(
  (acc, [servoName, { kinematics }]) => {
    acc[kinematics] = servoName
    return acc
  },
  {}
)

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
 * Forward kinematics
 * @param {KinematicsInput} args
 * @returns {KinematicsOutput}
 */
const FK = ({ q0, q1, q2 }) => {
  const { L1, L2, L3, H, dX } = L
  const r = (dX * Math.cos(d2r(q1)) + L1 * Math.sin(d2r(q1))) + L2 * Math.sin(d2r(q1 + q2))
  const z = H - L3 - dX * Math.sin(d2r(q1)) + L1 * Math.cos(d2r(q1)) + L2 * Math.cos(d2r(q1 + q2))
  const x = r * Math.cos(d2r(q0))
  const y = r * Math.sin(d2r(q0))
  return {
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z)
  }
}

/**
 * Inverse kinematics
 * @param {KinematicsOutput} args
 * @returns {KinematicsInput}
 */
const IK = ({ x, y, z }) => {
  const { L1, L2, L3, H, dX } = L
  const q0 = Math.atan2(y, x)
  const r = Math.hypot(x, y)
  const rw = r
  const zw = (z - H) + L3
  // -- Initial guess assuming dX = 0
  const D = Math.max(
    -1,
    Math.min(
      1,
      (rw * rw + zw * zw - L1 * L1 - L2 * L2) / (2 * L1 * L2)
    )
  )
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
  const q3 = Math.PI - q1 - q2
  return {
    q0: r2d(q0),
    q1: r2d(q1),
    q2: r2d(q2),
    q3: r2d(q3)
  }
}

export { FK, IK, K2S }