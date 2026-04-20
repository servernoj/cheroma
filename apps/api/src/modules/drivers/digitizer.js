import { writeRegister, readRegister } from '@/modules/i2c.js'
import { subscribe } from '@/modules/config.js'
import { keyBy, map } from 'lodash-es'

let addresses = []
let unitByAddress = {}
let targets = []
let enabled = false

subscribe(
  /** @param {Config} config */
  (config) => {
    enabled = config?.drivers?.digitizer?.enabled
    const units = config?.drivers?.digitizer?.mcp23017 ?? []
    if (units.length === 0) {
      throw new Error('config.drivers.digitizer.mcp23017 must be a non-empty array')
    }

    addresses = units.map(({ address }) => address)
    unitByAddress = keyBy(units, ({ address }) => `0x${address.toString(16)}`)
    targets = [...new Set(map(units, 'target'))]
  }, { immediate: true })

const R = {
  IODIR: 0x00,
  IOCON: 0x0A,
  IPOL: 0x02,
  GPPU: 0x0C,
  INTCON: 0x08,
  DEFVAL: 0x06,
  GPINTEN: 0x04,
  GPIO: 0x12,
  INTCAP: 0x10,
  INTF: 0x0E
}

const IOCON_SEQOP_MIRROR_ODR = 0b01000100

/**
 * Configure one MCP23017 unit at the given I2C address
 * @param {number} addr I2C address (e.g. 0x20)
 */
const initUnit = async (addr) => {
  await writeRegister(R.IOCON, [IOCON_SEQOP_MIRROR_ODR], addr)
  await writeRegister(R.IODIR, [0xff, 0xff], addr)
  await writeRegister(R.IPOL, [0xff, 0xff], addr)
  await writeRegister(R.GPPU, [0xff, 0xff], addr)
  await writeRegister(R.INTCON, [0xff, 0xff], addr)
  await writeRegister(R.DEFVAL, [0x00, 0x00], addr)
  await writeRegister(R.GPINTEN, [0xff, 0xff], addr)
}

/**
 * Initializes all MCP23017 units
 * and reads GPIO on each to clear any pending interrupt (releases INTA/INTB).
 */
const init = async () => {
  if (enabled) {
    for (const addr of addresses) {
      await initUnit(addr)
      await readRegister(R.GPIO, 2, addr)
    }
  }
}

export {
  init,
  enabled,
  addresses,
  unitByAddress,
  targets,
  R
}
