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
import * as digitizer from '@/modules/drivers/digitizer.js'
import { readRegister, writeRegister } from '@/modules/utils.js'

/** Delay (ms) after first interrupt before reading INTF/INTCAP, so multiple touches close in time can accumulate. */
const MULTI_TOUCH_WINDOW_MS = 10



/**
 * Clear any pending INT and re-enable GPINTEN on all MCPs. Call before a calibration run
 * so the digitizer is ready to trigger on touch.
 */
const initDigitizerForCapture = async () => {
  for (const addr of digitizer.addresses) {
    await readRegister(digitizer.R.GPIO, 2, addr)
    await writeRegister(digitizer.R.GPINTEN, [0xff, 0xff], addr)
  }
}

/**
 * Wait MULTI_TOUCH_WINDOW_MS, then read INTF/INTCAP and drain GPIO until interrupt flag clears.
 * Used by runPollUntilInterrupt (with deadline) and by calibration after an interrupt (no deadline).
 * Does not disable GPINTEN.
 * @param {{ deadline?: number }} [options] if deadline set, return null when passed (during drain loop)
 * @returns {Promise<Record<string, Array<number>> | null>}
 */
const readAndDrainTouchData = async (options = {}) => {
  /** @type {Record<string, number>} */
  const valueByAddress = {}
  for (const addr of digitizer.addresses) {
    const key = `0x${addr.toString(16)}`
    const buf = await readRegister(digitizer.R.INTF, 6, addr)
    valueByAddress[key] = (buf.readUint16LE() & buf.readUint16LE(2)) | buf.readUint16LE(4)
  }
  do {
    if (options.deadline != null && Date.now() >= options.deadline) return null
    for (const addr of digitizer.addresses) {
      const key = `0x${addr.toString(16)}`
      const buf = await readRegister(digitizer.R.GPIO, 2, addr)
      valueByAddress[key] |= buf.readUint16LE()
    }
    await sleep(5)
  } while (gpio.getInterruptFlag())
  const bitsByTarget = Object.entries(valueByAddress).reduce(
    (acc, [addr, value]) => {
      const config = digitizer.unitByAddress[addr]
      const bits = []
      let idx = config.offset
      do {
        if (value & 0x1) {
          bits.push(idx)
        }
        value >>= 1
        idx++
      } while (value)
      acc[config.target].push(...bits)
      return acc
    },
    digitizer.targets.reduce(
      (acc, t) => ({ ...acc, [t]: [] }),
      {}
    )
  )
  return bitsByTarget
}

/**
 * Poll every 10 ms until the interrupt flag is set or timeout. When flag is set:
 * 1) Read INTCAP (2 bytes) from each MCP and OR into result (capture what caused the interrupt).
 * 2) Do at least one pass reading GPIO from each MCP (OR into result), then repeat while the flag
 *    is still true; each read clears that chip's INT output (open-drain). We read all addresses
 *    each iteration; the shared INT line stays low until every chip has been read. Flag goes false
 *    only when no MCP drives the line low. Sleep is at the end of each iteration.
 *    On timeout in this loop, returns null (incomplete data — do not trust result).
 * @param {number} timeoutSec Timeout in seconds; loop breaks after this even if no interrupt.
 * @returns {Promise<Record<string, Array<number>> | null>}
 */
const runPollUntilInterrupt = async (timeoutSec) => {
  await initDigitizerForCapture()
  const deadline = Date.now() + timeoutSec * 1000
  for (; ;) {
    await sleep(10)
    if (Date.now() >= deadline) return null
    if (gpio.getInterruptFlag()) break
  }
  await sleep(MULTI_TOUCH_WINDOW_MS)
  const result = await readAndDrainTouchData({ deadline })
  if (result === null) return null
  await disableDigitizerInterrupts()
  return result
}

/**
 * Disable GPINTEN on all MCPs so the digitizer stops asserting INTA. Call at the end of
 * a calibration run (or after runPollUntilInterrupt, which does this internally).
 */
const disableDigitizerInterrupts = async () => {
  for (const addr of digitizer.addresses) {
    await writeRegister(digitizer.R.GPINTEN, [0, 0], addr)
  }
}

/**
 * Read GPIO on all MCPs until the interrupt flag clears. Call after a touch so the next
 * measurement does not see a stale flag.
 */
const clearDigitizerInterrupt = async () => {
  while (gpio.getInterruptFlag()) {
    for (const addr of digitizer.addresses) {
      await readRegister(digitizer.R.GPIO, 2, addr)
    }
    await sleep(2)
  }
}

/**
 * Convert touch data (same shape as runPollUntilInterrupt / readAndDrainTouchData) to
 * (x, y) in digitizer-local coordinates (mm from digitizer origin). Fill in the logic
 * based on the digitizer pattern (which 4 pins map to row/col and the 4 cases).
 * @param {Record<string, Array<number>>} touchData per-address port data (same shape as runPollUntilInterrupt / readAndDrainTouchData)
 * @returns {{ x: number, y: number }} position relative to digitizer origin
 */
const touchDataToDigitizerXY = (touchData) => {
  // TODO: implement from digitizer pattern (1r1c, 2r1c, 1r2c, 2r2c) → (x, y) in mm
  return { x: 0, y: 0 }
}

export {
  runPollUntilInterrupt,
  clearDigitizerInterrupt,
  initDigitizerForCapture,
  disableDigitizerInterrupts,
  readAndDrainTouchData,
  touchDataToDigitizerXY
}
