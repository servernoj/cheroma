import { writeRegister } from '@/modules/i2c.js'
import config from '@/config.json' with { type: 'json' }

const { address: deviceAddr, freq: desiredFreq } = config.drivers.pca9685
const prescale = Math.round(25e6 / (4096 * desiredFreq)) - 1
const freq = 25e6 / (4096 * (prescale + 1))

const REGS = {
  MODE1: 0x00,
  MODE2: 0x01,
  PRESCALE: 0xfe,
  BASE: 0x06
}

/**
 * Initializes PCA9685 driver
 */
const init = async () => {
  await writeRegister(REGS.MODE1, Buffer.from([0x10]), deviceAddr)
  await writeRegister(REGS.PRESCALE, Buffer.from([prescale]), deviceAddr)
  await writeRegister(REGS.MODE1, Buffer.from([0x20]), deviceAddr)
  await writeRegister(REGS.MODE2, Buffer.from([0x06]), deviceAddr)
}

export { init, freq, REGS, deviceAddr }
