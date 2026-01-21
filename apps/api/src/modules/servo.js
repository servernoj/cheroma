import { sleep, throttler, writeRegister } from './utils.js'
import config from '@/config.json' with {type: 'json'}

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xFE,
  BASE: 0x06
}

// PWM frequency
const freq = 50
// Determines number of intermediate points for `pathPlanner` function
const degPerPathSegment = 10
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
 * 
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
  return u0 + t * (u1 - u0)
}

/**
 * 
 * @param {number} angleDeg angle to convert to pulse width
 * @param {Array<ServoCalPoint>} sortedPoints Sorted array of calibration points (@see {@link ServoCalPoint})
 * @param {{clamp?: boolean}} options Options
 * @returns 
 */
const angleDegToPulseUsRaw = (angleDeg, sortedPoints, { clamp = true } = {}) => {
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
      acc[servoName] = sortedPoints
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
  const handler = ({ angleDeg, servoName }) => angleDeg === null
    ? 0
    : angleDegToPulseUsRaw(angleDeg, closure[servoName], { clamp })
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

const toHome = async (slow = true) => {
  if (slow) {
    await toPoint(getHomePosition())
  } else {
    await throttler({
      array: servoNames,
      handler: async servoName => {
        const { channel, home } = config.servos[servoName]
        await setChannel({
          channel,
          pulseWidthUs: angleDegToPulseUs({ angleDeg: home, servoName })
        })
        await sleep(200)
        currentPosition[servoName] = home
      },
      bulkSize: 1
    })
    await relax()
  }
}

/**
 * @param {ServoPosition} from a point to start from
 * @param {ServoPosition} to a point to land at
 */
const pathPlanner = (from, to) => {
  // -- determine the longest path
  const longestPathDeg = servoNames.reduce(
    (acc, servoName) => {
      const candidate = Math.abs(to[servoName] - from[servoName])
      if (candidate > acc) {
        acc = candidate
      }
      return acc
    },
    0
  )
  const numPoints = Math.ceil(longestPathDeg / degPerPathSegment) + 1
  const deltas = servoNames.reduce(
    (acc, servoName) => {
      acc[servoName] = (to[servoName] - from[servoName]) / (numPoints - 1)
      return acc
    },
    {}
  )
  /** @type {Array<ServoPosition>} */
  const points = Array(numPoints).fill().map(
    (_, idx) => {
      if (!idx) {
        return from
      }
      return servoNames.reduce(
        /** @param {*} acc */
        (acc, servoName) => {
          acc[servoName] = from[servoName] === null || to[servoName] === null
            ? null
            : from[servoName] + idx * deltas[servoName]
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
 */
const toPoint = async (toPosition) => {
  const points = pathPlanner(currentPosition, toPosition)
  await throttler({
    array: points,
    bulkSize: 1,
    handler: async (point) => {
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
      await sleep(10)
      currentPosition = point
    }
  })
  await relax()
}


export {
  setChannel,
  setChannels,
  init,
  toHome,
  relax,
  toPoint,
}