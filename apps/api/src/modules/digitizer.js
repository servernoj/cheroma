/**
 * Digitizer: PCB with 4 × MCP23017. Polls until interrupt flag is set or timeout, then reads
 * GPIO port A and B from all units and returns values.
 */
import { sleep } from '@/modules/utils.js'
import * as gpio from '@/modules/drivers/gpio.js'
import { addresses, R } from '@/modules/drivers/MCP23017.js'
import { readRegister } from '@/modules/utils.js'

/**
 * Poll every 10 ms until the interrupt flag is set or timeout is reached. On interrupt,
 * reads data (both INTCAP | GPIO) of ports A and B from all MCP23017 units.
 * @param {number} timeoutSec Timeout in seconds; loop breaks after this even if no interrupt.
 * @returns {Promise<Record<string, number>> | null} Data on interrupt, or null on timeout.
 */
const runPollUntilInterrupt = async (timeoutSec) => {
  const deadline = Date.now() + timeoutSec * 1000
  /** @type {Record<string,number>} */
  const result = {}
  for (; ;) {
    await sleep(10)
    if (Date.now() >= deadline) return null
    if (gpio.getInterruptFlag()) break
  }
  for (const addr of addresses) {
    const key = `0x${addr.toString(16)}`
    const buf = await readRegister(R.INTCAP, 2, addr)
    result[key] |= buf.readUint16BE()
  }
  while (gpio.getInterruptFlag()) {
    if (Date.now() >= deadline) return null
    for (const addr of addresses) {
      const key = `0x${addr.toString(16)}`
      const buf = await readRegister(R.GPIO, 2, addr)
      result[key] |= buf.readUint16BE()
    }
  }
  return result
}

export { runPollUntilInterrupt }
