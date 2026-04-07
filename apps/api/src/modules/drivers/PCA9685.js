import { writeRegister } from '@/modules/i2c.js'
import { subscribe } from '@/modules/config.js'

let deviceAddr
let freq
let prescale

subscribe(config => {
  const desiredFreq = config.drivers.pca9685.freq
  prescale = Math.round(25e6 / (4096 * desiredFreq)) - 1
  freq = 25e6 / (4096 * (prescale + 1))
  deviceAddr = config.drivers.pca9685.address
}, { immediate: true })

const getFreq = () => freq
const getDeviceAddr = () => deviceAddr

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

export { init, getFreq, REGS, getDeviceAddr }
