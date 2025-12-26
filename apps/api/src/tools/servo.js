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
  // Set PWM update and output preferences
  await writeRegister(REGS.MODE2, Buffer.from([0x0C]))
}

export const setChannel = async ({ channel, pulseWidthMs, ticks }) => {
  const off = Buffer.alloc(2)
  const offTicks = ticks ?? Math.round(pulseWidthMs * freq * 4096 / 1000)
  console.log({ channel, pulseWidthMs, offTicks })
  off.writeUInt16LE(offTicks)
  await writeRegister(REGS.BASE + 4 * channel, Buffer.from([0x00, 0x00, ...off]))
}