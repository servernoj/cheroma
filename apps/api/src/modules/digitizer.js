/**
 * Digitizer: PCB with 4 × MCP23017. Polls until interrupt flag is set or timeout, then reads
 * INTCAP (and then GPIO in a loop) from all units. Does not rely on delay or nextTick for
 * clearing the interrupt: we keep reading GPIO until the software flag goes false (callback
 * saw rising edge), so hardware and software stay in sync.
 * All MCPs use open-drain INT wired OR together to one line (e.g. GPIO 27). The line stays
 * low until every chip has been read and released; the flag going false means no MCP is
 * driving the line low.
 * To avoid contact bounce re-asserting INTA after we have cleared the flag, GPINTEN is
 * disabled only after the data-reading loop has drained the INT line, and re-enabled at
 * the start of the next run (not before return), so INTA stays released when the response is sent.
 */
import { sleep } from '@/modules/utils.js'
import * as gpio from '@/modules/drivers/gpio.js'
import { addresses, R } from '@/modules/drivers/MCP23017.js'
import { readRegister, writeRegister } from '@/modules/utils.js'

/** Delay (ms) after first interrupt before reading INTF/INTCAP, so multiple touches close in time can accumulate. */
const MULTI_TOUCH_WINDOW_MS = 12

/**
 * Poll every 10 ms until the interrupt flag is set or timeout. When flag is set:
 * 1) Read INTCAP (2 bytes) from each MCP and OR into result (capture what caused the interrupt).
 * 2) Do at least one pass reading GPIO from each MCP (OR into result), then repeat while the flag
 *    is still true; each read clears that chip's INT output (open-drain). We read all addresses
 *    each iteration; the shared INT line stays low until every chip has been read. Flag goes false
 *    only when no MCP drives the line low. Sleep is at the end of each iteration.
 *    On timeout in this loop, returns null (incomplete data — do not trust result).
 * @param {number} timeoutSec Timeout in seconds; loop breaks after this even if no interrupt.
 * @returns {Promise<Record<string, number> | null>} Per-address combined port data (key e.g. "0x20"), or null on timeout.
 */
const runPollUntilInterrupt = async (timeoutSec) => {
  // Clear any pending INT per chip, then re-enable interrupts (in case previous run left them disabled)
  for (const addr of addresses) {
    await readRegister(R.GPIO, 2, addr)
    await writeRegister(R.GPINTEN, [0xff, 0xff], addr)
  }
  const deadline = Date.now() + timeoutSec * 1000
  /** @type {Record<string,number>} */
  const result = {}
  for (; ;) {
    await sleep(10)
    if (Date.now() >= deadline) return null
    if (gpio.getInterruptFlag()) break
  }
  await sleep(MULTI_TOUCH_WINDOW_MS)
  for (const addr of addresses) {
    const key = `0x${addr.toString(16)}`
    const buf = await readRegister(R.INTF, 6, addr)
    result[key] = (buf.readUint16LE() & buf.readUint16LE(2)) | buf.readUint16LE(4)
  }
  do {
    if (Date.now() >= deadline) return null
    for (const addr of addresses) {
      const key = `0x${addr.toString(16)}`
      const buf = await readRegister(R.GPIO, 2, addr)
      result[key] |= buf.readUint16LE()
    }
    await sleep(5)
  } while (gpio.getInterruptFlag())
  // Disable MCP23017 interrupts so contact bounce after return cannot re-assert INTA
  for (const addr of addresses) {
    await writeRegister(R.GPINTEN, [0, 0], addr)
  }
  return result
}

export { runPollUntilInterrupt }
