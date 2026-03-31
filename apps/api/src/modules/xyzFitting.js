/**
 * TCP calibration: rigid registration + linear joint correction (no geometry fit, no box bounds).
 * Kinematic closure: q3 = gamma - q1_act - q2_act (gamma default 180°).
 */
import config from '../config.json' with { type: 'json' }
import { Matrix, solve } from 'ml-matrix'
import { cosd, sind, rotationMatrix, roundFactory } from './utils.js'

/**
 * Forward kinematics Q -> [x,y,z]
 * @param {number} q0
 * @param {number} q1
 * @param {number} q2
 * @param {number} q3
 * @param {{ H: number, L1: number, L2: number, L3: number, dX: number }} geom
 * @returns {[number, number, number]}
 */
export function FK(q0, q1, q2, q3, geom) {
  const Gamma = q1 + q2 + q3
  const rr =
    geom.dX * cosd(q1) +
    geom.L1 * sind(q1) +
    geom.L2 * sind(q1 + q2) +
    geom.L3 * sind(Gamma)
  return [
    rr * cosd(q0),
    rr * sind(q0),
    geom.H -
    geom.dX * sind(q1) +
    geom.L1 * cosd(q1) +
    geom.L2 * cosd(q1 + q2) +
    geom.L3 * cosd(Gamma)
  ]
}

/**
 * Cost function for residual vector `r`
 * @param {number[]} r
 * @returns {number}
 */
function costFn(r) {
  const v = Matrix.columnVector(r)
  return v.transpose().mmul(v).get(0, 0)
}

/**
 * Step scale for param `p_j` on every iteration depends on the amplitude of `p_j`
 * @param {*} p_j 
 * @returns how much increase `p_j` to compute J for the next iteration
 */
function stepScale(p_j) {
  return 1e-5 * Math.max(1, Math.abs(p_j))
}

/**
 * @param {number[]} r
 * @returns {{ rmse: number, rmseXyz: [number, number, number], maxError: number, errorNorms: number[] }}
 */
function residualStats(r) {
  const N = r.length / 3
  const E = new Matrix(3, N)
  for (let i = 0; i < N; i++) {
    E.set(0, i, r[3 * i])
    E.set(1, i, r[3 * i + 1])
    E.set(2, i, r[3 * i + 2])
  }
  const fro = E.norm('frobenius')
  const rmse = fro / Math.sqrt(r.length)
  const rmseXyz = /** @type {[number, number, number]} */ ([0, 1, 2].map(
    row => Math.sqrt(E.getRowVector(row).dot(E.getRowVector(row)) / N)
  ))
  const errorNorms = new Array(N)
  let maxError = 0
  for (let j = 0; j < N; j++) {
    const n = E.getColumnVector(j).norm('frobenius')
    errorNorms[j] = n
    if (n > maxError) maxError = n
  }
  return { rmse, rmseXyz, maxError, errorNorms }
}

/**
 * @param {object} input
 * @param {number[][]} input.Qcmd
 * @param {number[][]} input.Xmeas
 * @param {number} [input.gamma]
 * @param {object} [input.init] roll, pitch, yaw, t[3], a[3], b[3]
 * @returns {object} fit result (JSON-serializable)
 */
export function fitXyzFromMeasurements(input) {
  const { Qcmd, Xmeas, init } = input
  const gammaDeg = 180
  const geom = config.geom

  if (!Array.isArray(Qcmd) || !Array.isArray(Xmeas)) {
    throw new Error('Qcmd and Xmeas must be arrays')
  }
  if (Qcmd.length !== Xmeas.length) {
    throw new Error('Qcmd and Xmeas row counts must match')
  }
  if (Qcmd.length < 4) {
    throw new Error('Need at least 4 samples (12 unknowns, 3 equations per sample)')
  }

  /** @type {number[]} */
  let P
  if (init && typeof init === 'object') {
    const t = init.t ?? [0, 0, 0]
    const a = init.a ?? [1, 1, 1]
    const b = init.b ?? [0, 0, 0]
    if (t.length !== 3 || a.length !== 3 || b.length !== 3) {
      throw new Error('init.t, init.a, and init.b must each have length 3')
    }
    P = [
      init.roll ?? 0,
      init.pitch ?? 0,
      init.yaw ?? 0,
      ...t,
      ...a,
      ...b
    ]
  } else {
    P = [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0]
  }

  const residualFn = p => {
    const R = rotationMatrix(p[0], p[1], p[2])
    const t = Matrix.columnVector([p[3], p[4], p[5]])
    const a = [p[6], p[7], p[8]]
    const b = [p[9], p[10], p[11]]
    const N = Qcmd.length
    const r = new Array(3 * N)
    for (let i = 0; i < N; i++) {
      const q0 = a[0] * Qcmd[i][0] + b[0]
      const q1 = a[1] * Qcmd[i][1] + b[1]
      const q2 = a[2] * Qcmd[i][2] + b[2]
      const q3 = gammaDeg - q1 - q2
      const raw = Matrix.columnVector(
        FK(q0, q1, q2, q3, geom)
      )
      const pred = R.mmul(raw).add(t)
      const meas = Matrix.columnVector(Xmeas[i])
      const e = pred.subtract(meas)
      const base = 3 * i
      r[base] = e.get(0, 0)
      r[base + 1] = e.get(1, 0)
      r[base + 2] = e.get(2, 0)
    }
    return r
  }

  let r = residualFn(P)
  let cost = costFn(r)
  let lambda = 1e-3
  const maxIter = 500
  const costTol = 1e-12
  const stepTol = 1e-10
  const N = P.length
  const M = r.length
  let iterations = 0
  let converged = false
  let stalled = false

  for (let k = 0; k < maxIter; k++) {
    iterations = k + 1
    const J = new Matrix(M, N)
    for (let j = 0; j < N; j++) {
      const h = stepScale(P[j])
      const Pp = [...P]
      Pp[j] += h
      const rp = residualFn(Pp)
      const invH = 1 / h
      const col = new Array(M)
      for (let i = 0; i < M; i++) {
        col[i] = (rp[i] - r[i]) * invH
      }
      J.setColumn(j, col)
    }

    const A = J.transpose().mmul(J)
    const rhs = J.transpose().mmul(Matrix.columnVector(r)).neg()

    for (let j = 0; j < N; j++) {
      A.set(j, j, A.get(j, j) + lambda)
    }

    let dp
    try {
      dp = solve(A, rhs)
    } catch {
      lambda = Math.min(lambda * 10, 1e15)
      continue
    }

    const stepNorm = dp.norm('frobenius')

    const Ptry = P.map((pj, j) => pj + dp.get(j, 0))
    const rTry = residualFn(Ptry)
    const costTry = costFn(rTry)

    if (costTry < cost) {
      const relDec = (cost - costTry) / (cost + 1e-30)
      P = Ptry
      r = rTry
      cost = costTry
      lambda = Math.max(lambda * 0.33, 1e-15)
      if (relDec < costTol || stepNorm < stepTol) {
        converged = true
        break
      }
    } else {
      lambda = Math.min(lambda * 5, 1e15)
      if (lambda >= 1e15) {
        stalled = true
        break
      }
    }
  }

  const stats = residualStats(r)
  const tightFit = stats.rmse < 1e-5
  const rounder = roundFactory(4)
  P = P.map(rounder)
  return {
    roll: P[0],
    pitch: P[1],
    yaw: P[2],
    t: [P[3], P[4], P[5]],
    a: [P[6], P[7], P[8]],
    b: [P[9], P[10], P[11]],
    resnorm: cost,
    rmse: stats.rmse,
    rmseXyz: stats.rmseXyz,
    maxError: stats.maxError,
    errorNorms: stats.errorNorms,
    iterations,
    converged: converged || tightFit,
    stalled
  }
}
