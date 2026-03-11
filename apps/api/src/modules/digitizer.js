/**
 * Digitizer: PCB with 4× MCP23017. Polls until interrupt flag is set or timeout, then reads
 * GPIO port A and B from all units and returns values.
 */
import { sleep } from '@/modules/utils.js'
import * as gpio from '@/modules/drivers/gpio.js'
import { addresses, readGPIO } from '@/modules/drivers/MCP23017.js'

const toBinary = (byte) => '0b' + (byte >>> 0).toString(2).padStart(8, '0')

/**
 * Poll every 10 ms until the interrupt flag is set or timeout is reached. On interrupt,
 * reads GPIO A and B from all MCP23017 units.
 * @param {number} timeoutSec Timeout in seconds; loop breaks after this even if no interrupt.
 * @returns {Promise<{ A: number[], B: number[], A_binary: string[], B_binary: string[] } | null>}
 *   Data on interrupt, or null on timeout.
 */
const runPollUntilInterrupt = async (timeoutSec) => {
  const deadline = Date.now() + timeoutSec * 1000
  for (;;) {
    await sleep(10)
    if (Date.now() >= deadline) return null
    if (!gpio.getInterruptFlag()) continue
    const A = []
    const B = []
    for (const addr of addresses) {
      const { portA, portB } = await readGPIO(addr)
      A.push(portA)
      B.push(portB)
    }
    return {
      A,
      B,
      A_binary: A.map(toBinary),
      B_binary: B.map(toBinary)
    }
  }
}

export { runPollUntilInterrupt }
