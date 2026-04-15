import { Matrix, inverse } from 'ml-matrix'

/**
 * Fit quadratic mapping from target XY to measured XY.
 *
 * Model:
 *   xm = cx[0] + cx[1]*x + cx[2]*y + cx[3]*x² + cx[4]*x*y + cx[5]*y²
 *   ym = cy[0] + cy[1]*x + cy[2]*y + cy[3]*x² + cy[4]*x*y + cy[5]*y²
 *
 * Identity: cx = [0,1,0,0,0,0], cy = [0,0,1,0,0,0].
 *
 * @param {number[][]} data  N×4 array, each row [x_target, y_target, x_measured, y_measured]
 * @returns {{
 *   cx: [number, number, number, number, number, number],
 *   cy: [number, number, number, number, number, number],
 *   rmseRaw: number,
 *   rmseFit: number,
 *   N: number
 * }}
 */
const fitXYCorrection = (data) => {
  const N = data.length
  if (N < 6) {
    throw new Error(`Need at least 6 samples for quadratic fit, got ${N}`)
  }

  const xt = data.map(r => r[0])
  const yt = data.map(r => r[1])
  const xm = data.map(r => r[2])
  const ym = data.map(r => r[3])

  // design matrix A = [1, x, y, x², x*y, y²]  (N×6)
  const A = new Matrix(xt.map((x, i) => {
    const y = yt[i]
    return [1, x, y, x * x, x * y, y * y]
  }))
  const bx = Matrix.columnVector(xm)
  const by = Matrix.columnVector(ym)

  const At = A.transpose()
  const solve = inverse(At.mmul(A)).mmul(At)
  const cx = solve.mmul(bx).to1DArray()
  const cy = solve.mmul(by).to1DArray()

  // residuals
  const xmPred = A.mmul(Matrix.columnVector(cx)).to1DArray()
  const ymPred = A.mmul(Matrix.columnVector(cy)).to1DArray()

  let ssRaw = 0
  let ssFit = 0
  for (let i = 0; i < N; i++) {
    const exRaw = xm[i] - xt[i]
    const eyRaw = ym[i] - yt[i]
    ssRaw += exRaw * exRaw + eyRaw * eyRaw
    const rx = xm[i] - xmPred[i]
    const ry = ym[i] - ymPred[i]
    ssFit += rx * rx + ry * ry
  }

  return {
    cx: /** @type {[number, number, number, number, number, number]} */ (cx),
    cy: /** @type {[number, number, number, number, number, number]} */ (cy),
    rmseRaw: Math.sqrt(ssRaw / N),
    rmseFit: Math.sqrt(ssFit / N),
    N
  }
}

export { fitXYCorrection }
