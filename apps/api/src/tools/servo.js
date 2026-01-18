import { throttler, writeRegister } from './index.js'
import calData from '@/cal.json' with { type: 'json' }

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xFE,
  BASE: 0x06
}

const freq = 50

const interp = (a, p0, p1) => {
  const [a0, u0] = p0
  const [a1, u1] = p1
  if (a1 === a0) throw new Error('Duplicate angleDeg in sortedPoints')
  const t = (a - a0) / (a1 - a0)
  return u0 + t * (u1 - u0)
}

const angleDegToPulseUs = (angleDeg, sortedPoints, { clamp = true } = {}) => {
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


/**
 * Initializes PCA9685 controller
 */
export const init = async () => {
  // Put the controller to sleep
  await writeRegister(REGS.MODE1, Buffer.from([0x10]))
  // Set PWM frequency
  const prescale = Math.round(25e6 / (4096 * freq)) - 1
  await writeRegister(REGS.PRESCALE, Buffer.from([prescale]))
  // Wake up and set address auto increment
  await writeRegister(REGS.MODE1, Buffer.from([0x20]))
  // Set PWM output to HIGH and OE to high-z
  await writeRegister(REGS.MODE2, Buffer.from([0x06]))
}

export const setChannel = async ({ channel, pulseWidthMs, ticks }) => {
  const offTicksRaw = ticks ?? Math.round(pulseWidthMs * freq * 4096 / 1000)
  const offTicks = Math.max(0, Math.min(4095, offTicksRaw))

  console.log({ channel, pulseWidthMs, offTicksRaw, offTicks })

  // If offTicks is 0, force channel fully OFF (no pulses)
  if (offTicks === 0) {
    await writeRegister(REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, 0x00, 0x10]))
    return
  }
  const off = Buffer.alloc(2)
  off.writeUInt16LE(offTicks)
  await writeRegister(REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, ...off]))
}

export const relax = async (servos = null) => {
  servos = servos ?? Object.keys(calData.servos)
  await Promise.all(
    servos.map(
      async servoName => {
        const { channel } = calData.servos[servoName]
        await setChannel({ channel, ticks: 0, pulseWidthMs: undefined })
      }
    )
  )
}

export const home = async (servos = null) => {
  servos = servos ?? Object.keys(calData.servos)

  await throttler({
    array: servos,
    bulkSize: 1,
    handler: async servoName => {
      const { channel, home, calPoints } = calData.servos[servoName]
      const sortedPoints = calPoints.slice().sort(
        (a, b) => a[0] - b[0]
      )
      const pulseUs = angleDegToPulseUs(home, sortedPoints, { clamp: false })
      await setChannel({ channel, pulseWidthMs: pulseUs / 1000, ticks: undefined })
    }
  })
}

export {
  calData
}