import { cosd, sind, d2r, r2d } from '@/modules/utils.js'
import { subscribe } from '@/modules/config.js'

let geom
let k2s
/** @type {XYCorrection} */
let xyCorr
/** @type {ZCorrection} */
let zCorr

subscribe(config => {
  geom = config.geom
  xyCorr = config.xyCorrection
  zCorr = config.zCorrection
  k2s = Object.entries(config.servos).reduce(
    (acc, [servoName, { kinematics }]) => {
      acc[kinematics] = servoName
      return acc
    },
    {}
  )
}, { immediate: true })

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
 * Evaluate the forward quadratic mapping at (x, y).
 * f(x,y) = c[0] + c[1]*x + c[2]*y + c[3]*x² + c[4]*x*y + c[5]*y²
 * @param {XYCorrectionCoeffs} c
 * @param {number} x
 * @param {number} y
 */
const evalPoly = (c, x, y) =>
  c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y

/**
 * Pre-distort target XY by inverting the fitted quadratic mapping via Newton's method.
 * Model: xm = fx(xt, yt), ym = fy(xt, yt)  (quadratic polynomials)
 * Finds (xi, yi) such that fx(xi, yi) = x_desired, fy(xi, yi) = y_desired.
 * @param {KinematicsOutput} P
 * @returns {KinematicsOutput}
 */
const applyXYCorrection = ({ x, y, z }) => {
  const { cx, cy } = xyCorr
  let xi = x, yi = y
  for (let iter = 0; iter < 10; iter++) {
    const fx = evalPoly(cx, xi, yi) - x
    const fy = evalPoly(cy, xi, yi) - y
    if (fx * fx + fy * fy < 1e-12) break
    // Jacobian: J = [dfx/dx dfx/dy; dfy/dx dfy/dy]
    const j00 = cx[1] + 2 * cx[3] * xi + cx[4] * yi
    const j01 = cx[2] + cx[4] * xi + 2 * cx[5] * yi
    const j10 = cy[1] + 2 * cy[3] * xi + cy[4] * yi
    const j11 = cy[2] + cy[4] * xi + 2 * cy[5] * yi
    const det = j00 * j11 - j01 * j10
    xi -= ( j11 * fx - j01 * fy) / det
    yi -= (-j10 * fx + j00 * fy) / det
  }
  return { x: xi, y: yi, z }
}

/**
 * Evaluate the forward quadratic Z mapping.
 * fz(x,y,z) = cz[0] + cz[1]*x + cz[2]*y + cz[3]*z + cz[4]*x² + cz[5]*y²
 *            + cz[6]*z² + cz[7]*x*y + cz[8]*x*z + cz[9]*y*z
 * @param {ZCorrectionCoeffs} cz
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
const evalPolyZ = (cz, x, y, z) =>
  cz[0] + cz[1] * x + cz[2] * y + cz[3] * z +
  cz[4] * x * x + cz[5] * y * y + cz[6] * z * z +
  cz[7] * x * y + cz[8] * x * z + cz[9] * y * z

/**
 * Pre-distort target Z by inverting the fitted quadratic Z mapping via Newton's method.
 * Finds zi such that fz(x, y, zi) = z_desired (x, y are held fixed).
 * @param {KinematicsOutput} P
 * @returns {KinematicsOutput}
 */
const applyZCorrection = ({ x, y, z }) => {
  const { cz } = zCorr
  let zi = z
  for (let iter = 0; iter < 10; iter++) {
    const fz = evalPolyZ(cz, x, y, zi) - z
    if (fz * fz < 1e-12) break
    // dfz/dz = cz[3] + 2*cz[6]*z + cz[8]*x + cz[9]*y
    const dfdz = cz[3] + 2 * cz[6] * zi + cz[8] * x + cz[9] * y
    zi -= fz / dfdz
  }
  return { x, y, z: zi }
}

/**
 * @param {KinematicsOutput} P 
 * @returns {ServoPosition}
 */
const IKK = P => K2S(IK(applyZCorrection(applyXYCorrection(P))))

export { FK, IK, IKK, K2S }