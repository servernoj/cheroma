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

const r2d = r => r * 180 / Math.PI
const d2r = d => d * Math.PI / 180

/**
 * Forward kinematics
 * @param {KinematicsInput} args
 * @returns {KinematicsOutput}
 */
const FK = ({ q0, q1, q2, q3 }) => {
  const { L1, L2, L3, H } = L
  const r = L1 * Math.sin(d2r(q1)) + L2 * Math.sin(d2r(q1 + q2)) + L3 * Math.sin(d2r(q1 + q2 + q3))
  const z = H + L1 * Math.cos(d2r(q1)) + L2 * Math.cos(d2r(q1 + q2)) + L3 * Math.cos(d2r(q1 + q2 + q3))
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
  const { L1, L2, L3, H } = L
  const gamma = 180
  const q0 = Math.atan2(y, x)
  const r_squared = x * x + y * y
  const r = Math.sqrt(r_squared)
  const z2 = z - H + L3
  const D = (r_squared + z2 * z2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)
  if (Math.abs(D) > 1) {
    throw new Error('Position unreachable')
  }
  const q2_r = [
    Math.atan2(+Math.sqrt(1 - D * D), D),
    Math.atan2(-Math.sqrt(1 - D * D), D)
  ]
  const q1_r = q2_r.map(
    q2 => {
      const A = L1 + L2 * Math.cos(q2)
      const B = L2 * Math.sin(q2)
      return Math.atan2(A * r - B * z2, B * r + A * z2)
    }
  )
  const z_elbow = q1_r.map(
    q1 => H + L1 * Math.cos(q1)
  )
  const idx = z_elbow[0] > z_elbow[1] ? 0 : 1
  const [q1, q2] = [
    r2d(q1_r[idx]),
    r2d(q2_r[idx])
  ]
  const q3 = gamma - q1 - q2
  return { q0, q1, q2, q3 }
}

console.log(FK({
  q0: -60,
  q1: 90,
  q2: 0,
  q3: 0
}))

export { FK, IK }