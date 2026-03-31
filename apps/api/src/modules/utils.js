import { Matrix } from 'ml-matrix'

/**
 * Sleep for specified number of milliseconds
 * @param {number} ms Sleep time
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(
  resolve => {
    const timer = setTimeout(
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      ms
    )
  }
)

/**
 * Factory producing arbitrary precision rounder
 * @param {number} precision number of digits in fractional part
 * @returns {(x:number) => number} 
 */
const roundFactory = (precision = 2) => x => {
  const gain = Math.pow(10, precision)
  return Math.round(x * gain) / gain
}

/**
 * Calculates median over numerical array
 * @param {Array<number>} arr 
 * @returns number
 */
const median = (arr) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * 
 * @param {{
 *   array: Array<any>
 *   handler: (args: any) => Promise<void>
 *   bulkSize: number
 *   bulkHandler?: (args: Array<any>) => Promise<void>
 * }} args 
 * @returns 
 */
const throttler = (
  {
    array,
    handler,
    bulkHandler,
    bulkSize = 10
  }) => {
  const numGroups = Math.ceil(array.length / bulkSize)
  const groups = Array(numGroups).fill([]).map((_, index) => {
    const start = index * bulkSize
    const end = start + bulkSize
    return array.slice(start, end)
  })
  const bulkHandlerMultiplexed = bulkHandler || ((g) => Promise.all(g.map(handler)))
  return groups.reduce(
    (p, g) => p.then(
      prev => bulkHandlerMultiplexed(g).then(current => [...prev, ...current])
    ),
    Promise.resolve([])
  )
}

const toBinary = (byte) => '0b' + (byte >>> 0).toString(2).padStart(8, '0')

const d2r = d => (d * Math.PI) / 180
const r2d = r => r * 180 / Math.PI

const cosd = d => Math.cos(d2r(d))

const sind = d => Math.sin(d2r(d))

const rotationMatrix = (rollDeg, pitchDeg, yawDeg) => {
  const cr = cosd(rollDeg)
  const sr = sind(rollDeg)
  const cp = cosd(pitchDeg)
  const sp = sind(pitchDeg)
  const cy = cosd(yawDeg)
  const sy = sind(yawDeg)
  const Rx = new Matrix([
    [1, 0, 0],
    [0, cr, -sr],
    [0, sr, cr]
  ])
  const Ry = new Matrix([
    [cp, 0, sp],
    [0, 1, 0],
    [-sp, 0, cp]
  ])
  const Rz = new Matrix([
    [cy, -sy, 0],
    [sy, cy, 0],
    [0, 0, 1]
  ])
  return Rz.mmul(Ry).mmul(Rx)
}

export {
  sleep,
  throttler,
  toBinary,
  median,
  roundFactory,
  d2r,
  r2d,
  cosd,
  sind,
  rotationMatrix
}