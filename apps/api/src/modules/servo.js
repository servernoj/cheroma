import { writeRegister } from './i2c.js'
import { sleep } from './utils.js'
import { IK, toModel, K2S } from '@/modules/kinematics.js'
import * as PCA9685 from '@/modules/drivers/PCA9685.js'
import { performance } from 'node:perf_hooks'
import { subscribe } from '@/modules/config.js'

/**
 * Live snapshot from config + motion state. Populated by `applyConfigFromSnapshot` (subscribe + immediate).
 * @type {{
 *   servos: ServoData
 *   dtMs: number
 *   isDebug: boolean
 *   angleDegToPulseUs: (args: { angleDeg: number | null, servoName: ServoName }) => number
 *   currentPosition: ServoPosition
 * }}
 */
const runtime = {
  servos: /** @type {ServoData} */ (/** @type {unknown} */ (null)),
  dtMs: 0,
  isDebug: false,
  angleDegToPulseUs: /** @type {(args: { angleDeg: number | null, servoName: ServoName }) => number} */ (
    () => {
      throw new Error('servo runtime not initialized (config subscribe did not run)')
    }
  ),
  currentPosition: /** @type {ServoPosition} */ (/** @type {unknown} */ (null))
}

/**
 * @param {'home' | 'init'} poseName
 * @returns {ServoPosition}
 */
const getPosePosition = (poseName) => {
  return Object.entries(runtime.servos).reduce(
    /** @param {*} acc */
    (acc, [servoName, servo]) => ({
      ...acc,
      [servoName]: servo[poseName]
    }),
    {}
  )
}

/**
 * @param {ServoPosition} position
 */
const setCurrentPosition = (position) => {
  runtime.currentPosition = { ...position }
}

/**
 * @param {ServoData} servos
 * @param {{ clamp?: boolean }} [options]
 */
const buildAngleDegToPulseUs = (servos, { clamp = true } = {}) => {
  const interp = (angle, begin, end) => {
    const [a0, u0] = begin
    const [a1, u1] = end
    if (a1 === a0) throw new Error('Duplicate angleDeg in sortedPoints')
    const t = (angle - a0) / (a1 - a0)
    // IMPORTANT: keep as float microseconds here.
    // Rounding too early causes "stair-step" motion when angle increments are small.
    return u0 + t * (u1 - u0)
  }

  const angleDegToPulseUsRaw = (angleDeg, { sortedPoints, fitting, clamp: clampAngle = true }) => {
    if (!Array.isArray(sortedPoints) || sortedPoints.length < 2) {
      throw new Error('sortedPoints must have at least 2 [angleDeg, pulseUs] points')
    }
    angleDeg = (angleDeg - fitting.offset) / fitting.scale
    const n = sortedPoints.length
    if (angleDeg <= sortedPoints[0][0]) {
      if (clampAngle) {
        return sortedPoints[0][1]
      }
      return interp(angleDeg, sortedPoints[0], sortedPoints[1])
    }
    if (angleDeg >= sortedPoints[n - 1][0]) {
      if (clampAngle) {
        return sortedPoints[n - 1][1]
      }
      return interp(angleDeg, sortedPoints[n - 2], sortedPoints[n - 1])
    }
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (sortedPoints[mid][0] <= angleDeg) {
        lo = mid
      }
      else hi = mid
    }
    return interp(angleDeg, sortedPoints[lo], sortedPoints[lo + 1])
  }

  const perServo = Object.entries(servos).reduce(
    (acc, [servoName, { calPoints, fitting }]) => {
      const sortedPoints = calPoints.slice().sort(
        (a, b) => a[0] - b[0]
      )
      acc[servoName] = { sortedPoints, fitting }
      return acc
    },
    /** @type {Record<string, { sortedPoints: Array<ServoCalPoint>, fitting: ServoFitting }>} */({})
  )
  return ({ angleDeg, servoName }) =>
    angleDegToPulseUsRaw(angleDeg, { ...perServo[servoName], clamp })
}

subscribe((config) => {
  runtime.servos = config.servos
  runtime.dtMs = config.drivers.pca9685.dtMs
  runtime.isDebug = config.options.debug
  runtime.angleDegToPulseUs = buildAngleDegToPulseUs(runtime.servos, { clamp: false })
  runtime.currentPosition = runtime.currentPosition ?? getPosePosition('init')
}, { immediate: true })

/**
 * @param {ServoPosition} position
 * @returns {Array<{ channel: number, pulseWidthUs: number }>}
 */
const positionToSetChannelsData = (position) => Object.entries(position).map(
  /** @param {*} arg */
  ([servoName, angleDeg]) => ({
    channel: runtime.servos[servoName].channel,
    pulseWidthUs: runtime.angleDegToPulseUs({ angleDeg, servoName })
  })
)

/**
 * @param {SetChannel} channel
 */
const setChannel = async ({ channel, pulseWidthUs }) => {
  const offTicks = Math.max(
    0,
    Math.min(
      4095,
      Math.round(pulseWidthUs * PCA9685.getFreq() * 4096 / 1e6)
    )
  )
  if (offTicks === 0) {
    await writeRegister(PCA9685.REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, 0x00, 0x10]), PCA9685.getDeviceAddr())
    return
  }
  if (offTicks >= 4095) {
    await writeRegister(PCA9685.REGS.BASE + 4 * channel, Buffer.from([0x00, 0x10, 0x00, 0x00]), PCA9685.getDeviceAddr())
    return
  }
  const off = Buffer.alloc(2)
  off.writeUInt16LE(offTicks)
  await writeRegister(PCA9685.REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, ...off]), PCA9685.getDeviceAddr())
}

/**
 * @param {Array<SetChannel>} channels
 */
const setChannels = async (channels) => {
  const sortedChannels = channels.slice().sort(
    (a, b) => a.channel - b.channel
  )
  const N = sortedChannels.length
  if (sortedChannels[0].channel + N - 1 !== sortedChannels[N - 1].channel) {
    throw new Error('Channels must be consecutive')
  }
  const defaultValue = Buffer.from([0x00, 0x00, 0x00, 0x10])
  const off = Buffer.alloc(2)
  const writeData = sortedChannels.reduce(
    (acc, { pulseWidthUs }) => {
      let value = defaultValue
      if (pulseWidthUs) {
        const offTicks = Math.max(
          0,
          Math.min(
            4095,
            Math.round(pulseWidthUs * PCA9685.getFreq() * 4096 / 1e6)
          )
        )
        off.writeUInt16LE(offTicks)
        value = Buffer.from([0x00, 0x00, ...off])
      }
      return Buffer.from([...acc, ...value])
    },
    Buffer.from([])
  )
  await writeRegister(PCA9685.REGS.BASE + 4 * sortedChannels[0].channel, writeData, PCA9685.getDeviceAddr())
}

const doRelax = async () => {
  await Promise.all(
    Object.keys(runtime.servos).map(
      async (servoName) => {
        const { channel } = runtime.servos[servoName]
        await setChannel({ channel, pulseWidthUs: 0 })
      }
    )
  )
}

/**
 * @param {ServoPosition} from
 * @param {ServoPosition} to
 * @param {{
 *   dtMs?: number,
 *   vMaxDegPerSec?: number,
 *   easing?: 'quintic'
 * }} [options]
 * @returns {Array<ServoPosition>}
 */
const pathPlanner = (from, to, options) => {
  const {
    dtMs,
    vMaxDegPerSec,
    easing = 'quintic'
  } = options ?? {}

  if (dtMs <= 0) throw new Error('dtMs must be > 0')
  if (vMaxDegPerSec <= 0) throw new Error('vMaxDegPerSec must be > 0')
  if (easing !== 'quintic') throw new Error(`Unsupported easing: ${easing}`)

  /** Quintic ease-in-out: zero velocity + zero accel at endpoints. @param {number} t in [0,1] */
  const easeQuintic = (t) => {
    const t2 = t * t
    const t3 = t2 * t
    const t4 = t3 * t
    const t5 = t4 * t
    return 10 * t3 - 15 * t4 + 6 * t5
  }

  const dtSec = dtMs / 1000
  const servoNames = Object.keys(runtime.servos)

  const maxDeltaDeg = servoNames.reduce(
    (acc, servoName) => {
      const d = Math.abs(to[servoName] - from[servoName])
      return d > acc ? d : acc
    },
    0
  )
  if (maxDeltaDeg === 0) {
    return [from]
  }

  const T = maxDeltaDeg * 15 / (8 * vMaxDegPerSec)
  const N = Math.max(2, Math.ceil(T / dtSec) + 1)

  return Array(N).fill().map(
    (_, idx) => {
      const tau = idx / (N - 1)
      const s = easeQuintic(tau)
      return servoNames.reduce(
        /** @param {*} acc */
        (acc, servoName) => {
          const start = from[servoName]
          const delta = to[servoName] - start
          acc[servoName] = start + s * delta
          return acc
        },
        {}
      )
    }
  )
}

/**
 * @param {Array<{ point: ServoPosition, setChannelsData: Array<SetChannel> }>} steps
 * @param {number} stepMs
 */
const executeTimedMotionSteps = async (steps, stepMs) => {
  let nextTick = performance.now() + stepMs
  for (const { point, setChannelsData } of steps) {
    await setChannels(setChannelsData)
    runtime.currentPosition = point
    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += stepMs
    } else {
      nextTick = now + stepMs
    }
  }
}

/**
 * @param {ServoPosition} toPosition
 * @param {Array<ServoPosition>} [via]
 * @param {{
 *   relax?: boolean,
 *   dtMs?: number,
 *   vMaxDegPerSec?: number,
 * }} [options]
 */
const toPoint = async (toPosition, via = [], options) => {
  const {
    relax = true,
    vMaxDegPerSec = 60,
  } = options ?? {}
  const motionStepMs = runtime.dtMs
  const { points } = [...via, toPosition].reduce(
    (acc, next, idx) => {
      const segmentPoints = pathPlanner(
        acc.last,
        next,
        { dtMs: motionStepMs, vMaxDegPerSec, easing: 'quintic' }
      )
      if (idx > 0 && segmentPoints.length > 0) {
        segmentPoints.shift()
      }
      acc.last = next
      acc.points.push(
        ...segmentPoints.map(
          point => ({
            point,
            setChannelsData: positionToSetChannelsData(point)
          })
        )
      )
      return acc
    },
    {
      points: [],
      last: runtime.currentPosition
    }
  )
  await executeTimedMotionSteps(points, motionStepMs)
  if (relax) {
    await doRelax()
  }
}

/**
 * @param {KinematicsOutput} start
 * @param {KinematicsOutput} delta
 * @param {{ maxSpeed?: number }} [options]
 */
const line = async (start, delta, options) => {
  const {
    maxSpeed = 100
  } = options ?? {}
  const lineStepMs = runtime.dtMs * 2
  const dtSec = lineStepMs / 1000
  const maxDistance = Math.max(...Object.values(delta).map(Math.abs))
  const T = Math.round(maxDistance / maxSpeed)
  const N = Math.max(2, Math.ceil(T / dtSec) + 1)
  const denom = N - 1
  const points = Array(N).fill().map(
    (_, idx) => {
      const point = K2S(IK(toModel({
        x: start.x + idx * delta.x / denom,
        y: start.y + idx * delta.y / denom,
        z: start.z + idx * delta.z / denom,
      })))
      return {
        point,
        setChannelsData: positionToSetChannelsData(point)
      }
    }
  )
  await executeTimedMotionSteps(points, lineStepMs)
}

export {
  getPosePosition,
  setCurrentPosition,
  positionToSetChannelsData,
  setChannel,
  setChannels,
  doRelax,
  toPoint,
  line
}
