import { Matrix } from 'ml-matrix'

/**
 * Fit quadratic mapping from target (x, y, z) to measured z.
 *
 * Model:
 *   zm = cz[0] + cz[1]*x + cz[2]*y + cz[3]*z + cz[4]*x² + cz[5]*y²
 *        + cz[6]*z² + cz[7]*x*y + cz[8]*x*z + cz[9]*y*z
 *
 * Identity: cz = [0,0,0,1,0,0,0,0,0,0].
 *
 * Input can be N×6 [xt, yt, zt, xm, ym, zm] or N×4 [xt, yt, zt, zm].
 *
 * @param {number[][]} data
 * @returns {{
 *   cz: [number, number, number, number, number, number, number, number, number, number],
 *   rmseRaw: number,
 *   rmseFit: number,
 *   N: number
 * }}
 */
const fitZCorrection = (data) => {
  const N = data.length
  const cols = data[0].length
  if (N < 10) {
    throw new Error(`Need at least 10 samples for quadratic Z fit, got ${N}`)
  }

  let xt, yt, zt, zm
  if (cols === 6) {
    xt = data.map(r => r[0])
    yt = data.map(r => r[1])
    zt = data.map(r => r[2])
    zm = data.map(r => r[5])
  } else if (cols === 4) {
    xt = data.map(r => r[0])
    yt = data.map(r => r[1])
    zt = data.map(r => r[2])
    zm = data.map(r => r[3])
  } else {
    throw new Error(`Expected 4 or 6 columns, got ${cols}`)
  }

  // design matrix [1, x, y, z, x², y², z², xy, xz, yz]  (N×10)
  const A = new Matrix(xt.map((x, i) => {
    const y = yt[i], z = zt[i]
    return [1, x, y, z, x * x, y * y, z * z, x * y, x * z, y * z]
  }))
  const b = Matrix.columnVector(zm)

  const At = A.transpose()
  const cz = At.mmul(A).inverse().mmul(At).mmul(b).to1DArray()

  const zmPred = A.mmul(Matrix.columnVector(cz)).to1DArray()

  let ssRaw = 0
  let ssFit = 0
  for (let i = 0; i < N; i++) {
    const ezRaw = zm[i] - zt[i]
    ssRaw += ezRaw * ezRaw
    const rz = zm[i] - zmPred[i]
    ssFit += rz * rz
  }

  return {
    cz: /** @type {[number, number, number, number, number, number, number, number, number, number]} */ (cz),
    rmseRaw: Math.sqrt(ssRaw / N),
    rmseFit: Math.sqrt(ssFit / N),
    N
  }
}

export { fitZCorrection }
