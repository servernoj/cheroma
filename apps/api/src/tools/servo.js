import { writeRegister } from './index.js'

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xFE,
  BASE: 0x06
}

const freq = 50

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