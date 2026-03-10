/**
 * MCP23017 16-bit I/O expander driver.
 * Bank 0 register map. Configuration:
 * - All pins as inputs (IODIRA=IODIRB=0xFF)
 * - Sequential mode (IOCON.SEQOP=0), open-drain interrupts (ODR=1), OR INTA/INTB (MIRROR=1)
 * - Inverted polarity (IPOL=0xFF): read 1 = pin grounded (active), 0 = pulled up (idle)
 * - Pull-ups on all pins (GPPU=0xFF)
 * - Interrupt when pin differs from DEFVAL: INTCON=0xFF, DEFVAL=0x00 (idle = 0 after inversion)
 * - Interrupt enable on all pins (GPINTEN=0xFF)
 */
import { writeRegister } from '@/modules/utils.js'
import config from '@/config.json' with { type: 'json' }

const addresses = config.drivers.mcp23017?.addresses ?? []

const R = {
  IODIR: 0x00,
  IOCON: 0x0a,
  IPOL: 0x02,
  GPPU: 0x0c,
  INTCON: 0x08,
  DEFVAL: 0x06,
  GPINTEN: 0x04
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
 * Initializes all MCP23017 units (addresses from config.drivers.mcp23017.addresses)
 */
const init = async () => {
  for (const addr of addresses) {
    await initUnit(addr)
  }
}

export { init, addresses, R }
