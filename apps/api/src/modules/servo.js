import { writeRegister } from './i2c.js'
import { sleep } from './utils.js'
import { IK, toModel, K2S } from '@/modules/kinematics.js'
import * as PCA9685 from '@/modules/drivers/PCA9685.js'
import { performance } from 'node:perf_hooks'
import { subscribe } from '@/modules/config.js'

/** @type {ServoData} */
let servos
/** @type {number} */
let dtMs
/** @type {boolean} */
let isDebug
/** @type {(arg: 'home' | 'init') => ServoPosition} */
let getPosition
/** @type {ServoPosition} */
let currentPosition
/** @type {(arg: { angleDeg, servoName }) => number} */
let angleDegToPulseUs

/**
 * Set internal current position (e.g. after commanding angles outside toPoint/line).
 * @param {ServoPosition} position
 */
const setCurrentPosition = (position) => {
  currentPosition = { ...position }
}

/**
 * @param {number} angle Angle to interpolate pulseWidth for
 * @param {ServoCalPoint} begin Begin of the interpolation segment
 * @param {ServoCalPoint} end End of the interpolation segment
 * @returns {number} 
 */
const interp = (angle, begin, end) => {
  const [a0, u0] = begin
  const [a1, u1] = end
  if (a1 === a0) throw new Error('Duplicate angleDeg in sortedPoints')
  const t = (angle - a0) / (a1 - a0)
  // IMPORTANT: keep as float microseconds here.
  // Rounding too early causes "stair-step" motion when angle increments are small.
  return u0 + t * (u1 - u0)
}

/**
 * @param {number} angleDeg angle to convert to pulse width
 * @param {{
 *   sortedPoints: Array<ServoCalPoint>
 *   fitting: ServoFitting
 *   clamp?: boolean
 * }} options
 */
const angleDegToPulseUsRaw = (angleDeg, { sortedPoints, fitting, clamp = true }) => {
  if (!Array.isArray(sortedPoints) || sortedPoints.length < 2) {
    throw new Error('sortedPoints must have at least 2 [angleDeg, pulseUs] points')
  }
  angleDeg = (angleDeg - fitting.offset) / fitting.scale
  const n = sortedPoints.length
  // Handle left/right of table
  if (angleDeg <= sortedPoints[0][0]) {
    if (clamp) {
      return sortedPoints[0][1]
    }
    return interp(angleDeg, sortedPoints[0], sortedPoints[1])
  }
  if (angleDeg >= sortedPoints[n - 1][0]) {
    if (clamp) {
      return sortedPoints[n - 1][1]
    }
    return interp(angleDeg, sortedPoints[n - 2], sortedPoints[n - 1])
  }
  // Find segment [i, i+1]
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

const angleDegToPulseUsFactory = ({ clamp = true } = {}) => {
  const closure = Object.entries(servos).reduce(
    (acc, [servoName, { calPoints, fitting }]) => {
      const sortedPoints = calPoints.slice().sort(
        (a, b) => a[0] - b[0]
      )
      if (!acc[servoName]) {
        acc[servoName] = {}
      }
      acc[servoName].sortedPoints = sortedPoints
      acc[servoName].fitting = fitting
      return acc
    },
    {}
  )
  /**
   * @param {{
   *   angleDeg: number | null
   *   servoName: ServoName
   * }} args
   * @returns {number} pulseWidthUs
   */
  const handler = ({ angleDeg, servoName }) => angleDegToPulseUsRaw(angleDeg, { ...closure[servoName], clamp })
  return handler
}

subscribe(config => {
  servos = config.servos
  dtMs = config.drivers.pca9685.dtMs
  isDebug = config.options.debug
  angleDegToPulseUs = angleDegToPulseUsFactory({ clamp: false })

}, { immediate: true })

getPosition = (positionName) => Object.entries(servos).reduce(
  /** * @param {*} acc */
  (acc, [servoName, servo]) => {
    return {
      ...acc,
      [servoName]: servo[positionName]
    }
  },
  {}
)
currentPosition = getPosition('init')


/**
 * @param {ServoPosition} position joint angles in deg (keys = servo names)
 * @returns {Array<{ channel: number, pulseWidthUs: number }>}
 */
const positionToSetChannelsData = (position) => Object.entries(position).map(
  /** @param {*} arg*/
  ([servoName, angleDeg]) => ({
    channel: servos[servoName].channel,
    pulseWidthUs: angleDegToPulseUs({ angleDeg, servoName })
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
    Object.keys(servos).map(
      async servoName => {
        const { channel } = servos[servoName]
        await setChannel({ channel, pulseWidthUs: 0 })
      }
    )
  )
}

/**
 * Quintic ease-in-out: zero velocity + zero accel at endpoints.
 * @param {number} t in [0,1]
 */
const easeQuintic = (t) => {
  // 10t^3 - 15t^4 + 6t^5
  const t2 = t * t
  const t3 = t2 * t
  const t4 = t3 * t
  const t5 = t4 * t
  return 10 * t3 - 15 * t4 + 6 * t5
}

/**
 * Path planner: chooses number of points from max speed, then eases.
 * - Uses a fixed update cadence (dtMs) and computes steps so that the maximum joint
 *   motion does not exceed vMaxDegPerSec.
 * - Interpolates in joint space with a smooth easing curve (quintic) to reduce jerk.
 *
 * @param {ServoPosition} from a point to start from (deg)
 * @param {ServoPosition} to a point to land at (deg)
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

  const dtSec = dtMs / 1000

  // Determine maximum joint swing in degrees.
  const maxDeltaDeg = Object.keys(servos).reduce(
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

  const points = Array(N).fill().map(
    (_, idx) => {
      const tau = idx / (N - 1)
      const s = easeQuintic(tau)
      return Object.keys(servos).reduce(
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

  return points
}

/**
 * @param {ServoPosition} toPosition final position (angles in deg) to move servos
 * @param {Array<ServoPosition>} [via] list of intermediate points to be explicitly included
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
  const { points } = [...via, toPosition].reduce(
    (acc, next, idx) => {
      const segmentPoints = pathPlanner(
        acc.last,
        next,
        { dtMs, vMaxDegPerSec, easing: 'quintic' }
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
      last: currentPosition
    }
  )
  let nextTick = performance.now() + dtMs
  for (const { point, setChannelsData } of points) {
    await setChannels(setChannelsData)
    currentPosition = point
    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += dtMs
    } else {
      nextTick = now + dtMs
    }
  }
  if (relax) {
    await doRelax()
  }
}

/**
 * @param {KinematicsOutput} start 
 * @param {KinematicsOutput} delta 
 * @param {{
 *   maxSpeed?: number
 * }} [options] 
 */
const line = async (start, delta, options) => {
  const {
    maxSpeed = 100
  } = options ?? {}
  const _dtMs = dtMs * 2
  const dtSec = _dtMs / 1000
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
  let nextTick = performance.now() + _dtMs
  let slackCounter = 0
  for (const { point, setChannelsData } of points) {
    await setChannels(setChannelsData)
    currentPosition = point
    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += _dtMs
      slackCounter++
    } else {
      nextTick = now + _dtMs
    }
  }
  if (isDebug) {
    // The higher the number reported the better. Ideally 100% means that every step has a slack to sleep for. 
    console.log(`Slacked motion ratio: ${Math.round(slackCounter / points.length * 100)}%`)
  }
}

export {
  getPosition,
  setCurrentPosition,
  positionToSetChannelsData,
  setChannel,
  setChannels,
  doRelax,
  toPoint,
  line
}