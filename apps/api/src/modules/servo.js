import { sleep, throttler, writeRegister } from './utils.js'
import config from '@/config.json' with {type: 'json'}
import { performance } from 'node:perf_hooks'

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xFE,
  BASE: 0x06
}

// PWM frequency
const freq = 50
// Servo names as array
/** @type {Array<ServoName>} */
// @ts-ignore
const servoNames = Object.keys(config.servos)

/**
 * @returns {ServoPosition}
 */
const getHomePosition = () => Object.entries(config.servos).reduce(
  /** * @param {*} acc */
  (acc, [servoName, { home }]) => {
    return {
      ...acc,
      [servoName]: home
    }
  },
  {}
)

let currentPosition = getHomePosition()

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
 *   clamp?: boolean
 * }} options
 */
const angleDegToPulseUsRaw = (angleDeg, { sortedPoints, clamp = true }) => {
  if (!Array.isArray(sortedPoints) || sortedPoints.length < 2) {
    throw new Error('sortedPoints must have at least 2 [angleDeg, pulseUs] points')
  }
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
  const closure = Object.entries(config.servos).reduce(
    (acc, [servoName, { calPoints }]) => {
      const sortedPoints = calPoints.slice().sort(
        (a, b) => a[0] - b[0]
      )
      if (!acc[servoName]) {
        acc[servoName] = {}
      }
      acc[servoName].sortedPoints = sortedPoints
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

const angleDegToPulseUs = angleDegToPulseUsFactory({ clamp: false })

/**
 * Initializes PCA9685 driver
 */
const init = async () => {
  // Put the driver to sleep
  await writeRegister(REGS.MODE1, Buffer.from([0x10]))
  // Set PWM frequency
  const prescale = Math.round(25e6 / (4096 * freq)) - 1
  await writeRegister(REGS.PRESCALE, Buffer.from([prescale]))
  // Wake up and set address auto increment
  await writeRegister(REGS.MODE1, Buffer.from([0x20]))
  // Set PWM output to HIGH and OE to high-z
  await writeRegister(REGS.MODE2, Buffer.from([0x06]))
}

/**
 * @param {SetChannel} channel
 */
const setChannel = async ({ channel, pulseWidthUs }) => {
  const offTicks = Math.max(
    0,
    Math.min(
      4095,
      Math.round(pulseWidthUs * freq * 4096 / 1e6)
    )
  )
  if (offTicks === 0) {
    await writeRegister(REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, 0x00, 0x10]))
    return
  }
  const off = Buffer.alloc(2)
  off.writeUInt16LE(offTicks)
  await writeRegister(REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, ...off]))
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
            Math.round(pulseWidthUs * freq * 4096 / 1e6)
          )
        )
        off.writeUInt16LE(offTicks)
        value = Buffer.from([0x00, 0x00, ...off])
      }
      return Buffer.from([...acc, ...value])
    },
    Buffer.from([])
  )
  await writeRegister(REGS.BASE + 4 * sortedChannels[0].channel, writeData)
}

/**
 * @param {null | undefined | Array<string>} servos 
 */
const relax = async (servos = null) => {
  servos = servos ?? Object.keys(config.servos)
  await Promise.all(
    servos.map(
      async servoName => {
        const { channel } = config.servos[servoName]
        await setChannel({ channel, pulseWidthUs: 0 })
      }
    )
  )
}
/**
 * @param {{slow?: boolean, relax?: boolean}} [options] 
 */
const toHome = async (options = { slow: true, relax: true }) => {
  if (options.slow) {
    await toPoint(getHomePosition(), [], options)
  } else {
    await throttler({
      array: servoNames,
      handler: async servoName => {
        const { channel, home } = config.servos[servoName]
        await setChannel({
          channel,
          pulseWidthUs: angleDegToPulseUs({ angleDeg: home, servoName })
        })
        await sleep(500)
        currentPosition[servoName] = home
      },
      bulkSize: 1
    })
    if (options.relax) {
      await relax()
    }
  }
}

/**
 * @param {ServoPosition} from a point to start from
 * @param {ServoPosition} to a point to land at
 * @param {boolean} includeTo a flag controlling actual inclusion of the `to` point
 */
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
 * Smooth path planner: chooses number of points from max speed, then eases.
 *
 * - Uses a fixed update cadence (dtMs) and computes steps so that the maximum joint
 *   motion does not exceed vMaxDegPerSec.
 * - Interpolates in joint space with a smooth easing curve (quintic) to reduce jerk.
 *
 * @param {ServoPosition} from a point to start from (deg)
 * @param {ServoPosition} to a point to land at (deg)
 * @param {boolean} includeTo include the final point explicitly
 * @param {{
 *   dtMs?: number,
 *   vMaxDegPerSec?: number,
 *   easing?: 'quintic'
 * }} [options]
 * @returns {Array<ServoPosition>}
 */
const pathPlanner = (from, to, includeTo = true, options) => {
  const {
    dtMs = 20,
    vMaxDegPerSec = 90,
    easing = 'quintic'
  } = options ?? {}

  if (dtMs <= 0) throw new Error('dtMs must be > 0')
  if (vMaxDegPerSec <= 0) throw new Error('vMaxDegPerSec must be > 0')
  if (easing !== 'quintic') throw new Error(`Unsupported easing: ${easing}`)

  const dtSec = dtMs / 1000

  // Determine maximum joint swing in degrees.
  const maxDeltaDeg = servoNames.reduce(
    (acc, servoName) => {
      const d = Math.abs(to[servoName] - from[servoName])
      return d > acc ? d : acc
    },
    0
  )

  // No movement: either return [from] or [] depending on includeTo semantics.
  if (maxDeltaDeg === 0) {
    return includeTo ? [from] : []
  }

  // Choose number of points based on desired max speed.
  // T ~= maxDelta/vMax. With cadence dt, N ~= T/dt + 1.
  const T = maxDeltaDeg / vMaxDegPerSec
  const N = Math.max(2, Math.ceil(T / dtSec) + 1)

  const points = Array(N).fill().map(
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

  return includeTo ? points : points.slice(0, -1)
}

/**
 * Smooth version of `toPoint`:
 * - Builds a joint-space path using `pathPlannerSmooth` (variable number of steps).
 * - Uses quintic easing to reduce jerk and visible "stepping".
 * - Keeps a fixed update cadence (dtMs), matching typical 50Hz servo behavior.
 *
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
    relax: doRelax = true,
    dtMs = 20,
    vMaxDegPerSec = 45,
  } = options ?? {}

  const { points } = [...via, toPosition].reduce(
    (acc, next, idx, arr) => {
      const segmentPoints = pathPlanner(
        acc.last,
        next,
        idx === arr.length - 1,
        { dtMs, vMaxDegPerSec, easing: 'quintic' }
      )
      acc.points.push(...segmentPoints)
      acc.last = next
      return acc
    },
    {
      last: currentPosition,
      points: []
    }
  )
  let nextTick = performance.now() + dtMs
  for (let k = 0; k < points.length; k += 1) {
    const point = points[k]
    const setChannelsData = Object.entries(point).map(
      /** @param {*} arg*/
      ([servoName, angleDeg]) => {
        return {
          channel: config.servos[servoName].channel,
          pulseWidthUs: angleDegToPulseUs({ angleDeg, servoName })
        }
      }
    )
    await setChannels(setChannelsData)
    currentPosition = point

    const now = performance.now()
    const slack = nextTick - now
    if (slack > 0) {
      await sleep(slack)
      nextTick += dtMs
    } else {
      // Missed the tick: reset schedule so we don't "catch up" with bursts.
      nextTick = now + dtMs
    }
  }
  if (doRelax) {
    await relax()
  }
}

export {
  setChannel,
  setChannels,
  init,
  toHome,
  relax,
  toPoint,
}