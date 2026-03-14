/**
 * Calibration: automated collection of (Qcmd, Xmeas) at a grid of points for model fitting.
 * Flow per point: move to pre-target (Z + elevationMm), vertical descent until digitizer
 * touch, record commanded angles and measured XYZ, clear interrupt, return to home.
 */
import config from '@/config.json' with { type: 'json' }
import { IKK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import * as gpio from '@/modules/drivers/gpio.js'
import * as digitizer from '@/modules/digitizer.js'
import { sleep } from '@/modules/utils.js'
import { performance } from 'node:perf_hooks'

const dtMs = config.drivers.pca9685.dtMs

/**
 * @type {{[k in keyof KinematicsInput]: ServoName}}
 */
const servoNameByKinematics = Object.entries(config.servos).reduce(
  /** @param {*} acc */
  (acc, [servoName, { kinematics }]) => ({ ...acc, [kinematics]: servoName }),
  {}
)

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
  const maxSpeedMmPerSec = options.maxSpeedMmPerSec ?? 50
  const deltaZ = zBottom - zTop
  const maxDistance = Math.abs(deltaZ)
  const dtSec = dtMs / 1000
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
  let nextTick = performance.now() + dtMs
  for (let i = 0; i < points.length; i++) {
    const { angles } = points[i]
    await servo.setChannels(servo.positionToSetChannelsData(angles))
    servo.setCurrentPosition(angles)
    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += dtMs
    } else {
      nextTick = now + dtMs
    }
    if (gpio.getInterruptFlag()) {
      return { index: i, xyz: points[i].xyz, angles: points[i].angles }
    }
  }
  return null
}

/**
 * Run a full calibration sequence: for each grid point, pre-target → descent until touch → record → home.
 * Returns a flat 2D array for the fitting algorithm: each row is [q0, q1, q2, q3, x, y, z].
 * Robot frame: X parallel to files, increasing with rank; Y parallel to ranks, decreasing from file a to h.
 * @param {[number, number, number]} origin [x,y,z] in robot frame for grid (0,0) — row1 & col1 corner
 * @param {{ rows: number, cols: number }} grid rows = rank index count, cols = file index count
 * @param {number} stepMm step between grid points (mm); touch is at cell center, offset by stepMm/2 on both axes
 * @returns {Promise<number[][]>} one row per position: [q0, q1, q2, q3, x, y, z]
 */
const runCalibrationSequence = async (origin, grid, stepMm) => {
  const elevationMm = config.drivers.digitizer?.elevation ?? 50
  const [ox, oy, oz] = origin
  const { rows, cols } = grid
  const halfStep = stepMm / 2

  await digitizer.initDigitizerForCapture()

  /** @type {number[][]} */
  const data = []

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // i = rank index (X increases); j = file index (Y decreases from a to h). halfStep = center of cell.
      const target = { x: ox + i * stepMm + halfStep, y: oy - j * stepMm - halfStep, z: oz }
      const preTarget = { ...target, z: target.z + elevationMm }

      await servo.toPoint(IKK(preTarget), [], { relax: false })

      const trajectory = buildVerticalDescentTrajectory(
        target.x,
        target.y,
        preTarget.z,
        target.z
      )
      const result = await runInterruptibleDescent(trajectory)

      if (result === null) {
        await digitizer.clearDigitizerInterrupt()
        await digitizer.disableDigitizerInterrupts()
        await servo.toPoint(servo.getPosition('home'), [], { relax: true })
        throw new Error(
          `Calibration: no touch at grid (${i},${j}); descent completed without interrupt`
        )
      }

      const touchData = await digitizer.readAndDrainTouchData()
      const { x: digitizerX, y: digitizerY } = digitizer.touchDataToDigitizerXY(touchData)
      const [robotX, robotY] = [ox + digitizerX, oy - digitizerY]
      const zMeas = result.xyz.z

      const Qcmd = ['q0', 'q1', 'q2', 'q3'].map(
        k => result.angles[servoNameByKinematics[k]]
      )
      data.push([...Qcmd, robotX, robotY, zMeas])
      // Return to home after every position so the next measurement starts from the same pose
      await servo.toPoint(servo.getPosition('home'), [], { relax: true })
    }
  }

  await digitizer.disableDigitizerInterrupts()
  return data
}

export { buildVerticalDescentTrajectory, runInterruptibleDescent, runCalibrationSequence }
