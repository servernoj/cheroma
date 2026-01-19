import { sleep, throttler, writeRegister } from './index.js'
import calData from '@/cal.json' with { type: 'json' }

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xFE,
  BASE: 0x06
}

/**
 * @type {Partial<ServoPosition>}
 */
let currentPosition = {}

// PWM frequency
const freq = 50

/**
 * 
 * @param {number} angle Angle to interpolate pulseWidth for
 * @param {CalPoint} begin Begin of the interpolation segment
 * @param {CalPoint} end End of the interpolation segment
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
 * @param {Array<CalPoint>} sortedPoints Sorted array of calibration points (@see {@link CalPoint})
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
  const closure = Object.entries(calData.servos).reduce(
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
  servos = servos ?? Object.keys(calData.servos)
  await Promise.all(
    servos.map(
      async servoName => {
        const { channel } = calData.servos[servoName]
        await setChannel({ channel, pulseWidthUs: 0 })
      }
    )
  )
}

const home = async (slow = true) => {
  if (slow) {
    const toPosition = Object.entries(calData.servos).reduce(
      (acc, [servoName, { home }]) => ({ ...acc, [servoName]: home }),
      {}
    )
    // @ts-ignore
    await to(toPosition, 10)
  } else {
    await throttler({
      array: Object.keys(calData.servos),
      handler: async servoName => {
        const { channel, home } = calData.servos[servoName]
        await setChannel({
          channel,
          // @ts-ignore
          pulseWidthUs: angleDegToPulseUs({ angleDeg: home, servoName })
        })
        await sleep(200)
        currentPosition[servoName] = home
      },
      bulkSize: 1
    })
  }
}

/**
 * @param {Partial<ServoPosition>} from a point to start from
 * @param {Partial<ServoPosition>} to a point to land at
 * @param {number} numPoints total number of path points including `from` and `to`
 * @returns {Array<Partial<ServoPosition>>} array of intermediate points
 */
const pathPlanner = (from, to, numPoints = 2) => {
  const fromServoNames = Object.keys(from)
  const toServoNames = Object.keys(to)
  if (
    !fromServoNames.every(servoName => toServoNames.includes(servoName)) ||
    !toServoNames.every(servoName => fromServoNames.includes(servoName))
  ) {
    throw new Error('Both `from` and `to` points should reference exact same servos')
  }
  const deltas = fromServoNames.reduce(
    (acc, servoName) => {
      acc[servoName] = from[servoName] === null || to[servoName] === null
        ? null
        : (to[servoName] - from[servoName]) / (numPoints - 1)
      return acc
    },
    {}
  )
  const points = Array(numPoints).fill().map(
    (_, idx) => {
      if (!idx) {
        return from
      }
      return fromServoNames.reduce(
        /**
         * @param {Partial<ServoPosition>} acc 
         */
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
 * @param {number} [numPoints]  total number of path points
 */
const to = async (toPosition, numPoints = 2) => {
  const points = pathPlanner(currentPosition, toPosition, numPoints)
  await throttler({
    array: points,
    bulkSize: 1,
    handler: async (point) => {
      const setChannelsData = Object.entries(point).map(
        ([servoName, angleDeg]) => {
          return {
            channel: calData.servos[servoName].channel,
            // @ts-ignore
            pulseWidthUs: angleDegToPulseUs({ angleDeg, servoName })
          }
        }
      )
      await setChannels(setChannelsData)
      await sleep(50)
      currentPosition = point
    }
  })
}


export {
  setChannel,
  setChannels,
  init,
  home,
  relax,
  to,
  calData
}