import { Matrix, inverse } from 'ml-matrix'

/**
 * Fit affine mapping from target XY to measured XY.
 *
 * Model:
 *   xm = cx[0] + cx[1]*x + cx[2]*y
 *   ym = cy[0] + cy[1]*x + cy[2]*y
 *
 * Identity: cx = [0,1,0], cy = [0,0,1].
 *
 * Correction (applied before IK):
 *   p_corrected = B^-1 * (p_desired - t)
 *   where B = [[cx[1],cx[2]],[cy[1],cy[2]]], t = [cx[0],cy[0]]
 *
 * @param {number[][]} data  N×4 array, each row [x_target, y_target, x_measured, y_measured]
 * @returns {{
 *   cx: [number, number, number],
 *   cy: [number, number, number],
 *   rmseRaw: number,
 *   rmseFit: number,
 *   N: number
 * }}
 */
const fitXYCorrection = (data) => {
  const N = data.length
  if (N < 3) {
    throw new Error(`Need at least 3 samples, got ${N}`)
  }

  const xt = data.map(r => r[0])
  const yt = data.map(r => r[1])
  const xm = data.map(r => r[2])
  const ym = data.map(r => r[3])

  const A = new Matrix(xt.map((x, i) => [1, x, yt[i]]))
  const bx = Matrix.columnVector(xm)
  const by = Matrix.columnVector(ym)

  const At = A.transpose()
  const solve = inverse(At.mmul(A)).mmul(At)
  const cx = solve.mmul(bx).to1DArray()
  const cy = solve.mmul(by).to1DArray()

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
    cx: /** @type {[number, number, number]} */ (cx),
    cy: /** @type {[number, number, number]} */ (cy),
    rmseRaw: Math.sqrt(ssRaw / N),
    rmseFit: Math.sqrt(ssFit / N),
    N
  }
}

export { fitXYCorrection }
