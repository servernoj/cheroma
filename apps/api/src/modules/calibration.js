/**
 * Calibration: automated collection of (Qcmd, Xmeas) at a grid of points for model fitting.
 * Flow per point: move to pre-target (Z + elevationMm), vertical descent until digitizer
 * touch, record commanded angles and measured XYZ, clear interrupt, return to home.
 */
import { subscribe } from '@/modules/config.js'
import { IKK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import * as gpio from '@/modules/drivers/gpio.js'
import * as digitizer from '@/modules/digitizer.js'
import { median, sleep } from '@/modules/utils.js'
import { performance } from 'node:perf_hooks'

let dtMs = Infinity
/**
 * @type {{[k in keyof KinematicsInput]: ServoName}}
 */
let servoNameByKinematics

subscribe(config => {
  dtMs = config.drivers.pca9685.dtMs
  servoNameByKinematics = Object.entries(config.servos).reduce(
    /** @param {*} acc */
    (acc, [servoName, { kinematics }]) => ({ ...acc, [kinematics]: servoName }),
    {}
  )
}, { immediate: true })

/**
 * Build trajectory points for vertical descent from (x,y,zTop) to (x,y,zBottom).
 * @param {number} x
 * @param {number} y
 * @param {number} zTop
 * @param {number} zBottom
 * @param {{ maxSpeedMmPerSec?: number }} [options]
 * @returns {Array<{ xyz: KinematicsOutput, angles: ServoPosition }>}
 */
const buildVerticalDescentTrajectory = (x, y, zTop, zBottom, options = {}) => {
  const _dtMs = 8 * dtMs
  const maxSpeedMmPerSec = options.maxSpeedMmPerSec ?? 10
  const deltaZ = zBottom - zTop
  const maxDistance = Math.abs(deltaZ)
  const dtSec = _dtMs / 1000
  const T = maxDistance / maxSpeedMmPerSec
  const N = Math.max(2, Math.ceil(T / dtSec) + 1)
  const denom = N - 1
  return Array.from({ length: N }, (_, idx) => {
    const z = zTop + (idx / denom) * deltaZ
    /** @type {KinematicsOutput} */
    const xyz = { x, y, z }
    const angles = IKK(xyz)
    return { xyz, angles }
  })
}

/**
 * Run descent trajectory step-by-step until GPIO interrupt (stylus touch). Stops at
 * current cadence and returns the point at which the interrupt occurred.
 * @param {Array<{ xyz: KinematicsOutput, angles: ServoPosition }>} points
 * @returns {Promise<{ index: number, xyz: KinematicsOutput, angles: ServoPosition } | null>} point at touch, or null if no interrupt
 */
const runInterruptibleDescent = async (points) => {
  const _dtMs = 8 * dtMs
  let nextTick = performance.now() + _dtMs
  for (let i = 0; i < points.length; i++) {
    const { angles } = points[i]
    await servo.setChannels(servo.positionToSetChannelsData(angles))
    servo.setCurrentPosition(angles)
    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += _dtMs
    } else {
      nextTick = now + _dtMs
    }
    if (gpio.getInterruptFlag()) {
      await sleep(200)
      return { index: i, xyz: points[i].xyz, angles: points[i].angles }
    }
  }
  return null
}

/**
 * Run a full calibration sequence: for each grid point, pre-target → descent until touch → record → home.
 * Returns a flat 2D array for the fitting algorithm: each row is [q0, q1, q2, q3, x, y, z].
 * Robot frame: X parallel to files, increasing with rank; Y parallel to ranks, decreasing from file a to h.
 * @param {{    
 *    origin: [number, number, number] 
 *    grid: { rows: number, cols: number },
 *    start: { rows: number, cols: number }
 *    stepMm: number
 *    repeat: number
 * }} args
 *  - origin: [x,y,z] in robot frame for grid (0,0) — row1 & col1 corner
 *  - grid: rows = rank index count, cols = file index count
 *  - start: initial starting point (rows/cols), defaults to (0,0)
 *  - stepMm: step between grid points (mm); touch is at cell center, offset by stepMm/2 on both axes
 *  - repeat: repeat each calibration point specified number of times
 * @returns {Promise<number[][]>} one row per position: [q0, q1, q2, q3, x, y, z]
 */
const runCalibrationSequence = async ({ origin, grid, start, stepMm, repeat }) => {
  const elevationMm = 50
  const [ox, oy, oz] = origin
  const { rows, cols } = grid
  const halfStep = stepMm / 2

  /** @type {number[][]} */
  const data = []
  let retry = false
  let skipRecording = false
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const row = (start?.rows ?? 0) + i
      const col = (start?.cols ?? 0) + j
      const poseData = []
      skipRecording = false
      for (let k = 0; k < repeat; k += retry ? 0 : 1) {
        // i = rank index (X increases); j = file index (Y decreases from a to h). halfStep = center of cell.
        const target = { x: ox + row * stepMm + halfStep, y: oy - col * stepMm - halfStep, z: oz }
        const preTarget = { ...target, z: target.z + elevationMm }

        await servo.toPoint(IKK(preTarget), [], { relax: false })
        await sleep(1000)

        const trajectory = buildVerticalDescentTrajectory(
          target.x,
          target.y,
          preTarget.z,
          target.z,
          {
            maxSpeedMmPerSec: 100
          }
        )
        await digitizer.initDigitizerForCapture()
        const result = await runInterruptibleDescent(trajectory)

        if (result === null) {
          console.warn(`Calibration: no touch at grid (${row},${col}); descent completed without interrupt`)
          skipRecording = true
          break
        }

        const touchData = await digitizer.readAndDrainTouchData()
        let digitizerX, digitizerY

        try {
          const { x, y } = digitizer.touchDataToDigitizerXY(touchData)
          digitizerX = x
          digitizerY = y
          retry = false
        } catch {
          retry = true
          continue
        }
        const [robotX, robotY] = [ox + digitizerY, oy - digitizerX]
        const zMeas = result.xyz.z

        const Qcmd = ['q0', 'q1', 'q2', 'q3'].map(
          key => result.angles[servoNameByKinematics[key]]
        )
        poseData.push([...Qcmd, robotX, robotY, zMeas])
        await servo.toPoint(IKK(preTarget), [], { relax: false })
      }
      if (skipRecording) {
        continue
      }
      // poseData: Array<[q0,q1,q2,q3,x,y,z]>
      if (!poseData.length || !poseData.every(r => r.length === poseData[0].length)) {
        throw new Error('Calibration: invalid poseData shape')
      }
      const colMedians = poseData[0].map((_, col) => median(poseData.map(r => r[col])))
      const weights = [0.5, 0.5, 0.5, 1, 1, 1, 1]
      let bestIdx = 0
      let bestScore = Infinity
      for (let i = 0; i < poseData.length; i++) {
        const row = poseData[i]
        let s = 0
        for (let j = 0; j < row.length; j++) {
          const d = row[j] - colMedians[j]
          s += weights[j] * d * d
        }
        if (s < bestScore) {
          bestScore = s
          bestIdx = i
        }
      }
      data.push(poseData[bestIdx])
    }
  }
  await servo.toPoint(servo.getPosePosition('home'), [], { relax: true })
  await digitizer.disableDigitizerInterrupts()
  return data
}

export { buildVerticalDescentTrajectory, runInterruptibleDescent, runCalibrationSequence }
