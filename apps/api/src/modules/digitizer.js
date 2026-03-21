/**
 * Digitizer application layer: four MCP23017 units on one I2C bus, INTA/INTB open-drain-wired
 * to a single host GPIO (pull-up). The host sets a software flag on falling edge (line driven
 * low) and clears it on rising edge.
 *
 * Touch capture: after a short settle delay, each MCP is read at INTF (six bytes); the three
 * little-endian uint16s are combined in code into one 16-bit mask per chip. A loop
 * then repeatedly reads live GPIO on every chip and ORs into the same masks so contacts that
 * close after the first interrupt still appear (same chip, multi-pin pattern). After a bounded
 * number of loop iterations, GPINTEN is cleared on all chips so the shared line can release
 * even if the stylus remains grounded. The loop continues until the software interrupt flag
 * is false (shared line high) or an optional deadline expires.
 */
import { sleep } from '@/modules/utils.js'
import * as gpio from '@/modules/drivers/gpio.js'
import * as digitizer from '@/modules/drivers/digitizer.js'
import { readRegister, writeRegister } from '@/modules/i2c.js'

/** Idle time after first interrupt before sampling, so near-simultaneous contacts can accumulate. */
const MULTI_TOUCH_WINDOW_MS = 10
/** Time budget for the GPIO capture loop; paired with CAPTURE_SLEEP_MS to cap iteration count before GPINTEN off. */
const CAPTURE_WINDOW_MS = 100
/** Delay between full GPIO read passes on all MCPs during capture. */
const CAPTURE_SLEEP_MS = 5
/** Interval while polling for the software interrupt flag (e.g. test endpoint). */
const TEST_POLL_MS = 10

/**
 * Clear any pending INT and re-enable GPINTEN on all MCPs.
 */
const initDigitizerForCapture = async () => {
  for (const addr of digitizer.addresses) {
    await readRegister(digitizer.R.GPIO, 2, addr)
    await writeRegister(digitizer.R.GPINTEN, [0xff, 0xff], addr)
  }
}

/**
 * After MULTI_TOUCH_WINDOW_MS: seed per-chip masks from a 6-byte read at INTF (bitwise merge of
 * the three uint16s as in code), then OR in live GPIO until the software interrupt flag clears.
 * Once the loop iteration count exceeds CAPTURE_WINDOW_MS / CAPTURE_SLEEP_MS, clears GPINTEN on
 * every subsequent iteration (alongside GPIO reads) until the software flag clears, so the shared
 * line can release under sustained contact.
 * @param {{ deadline?: number }} [options] if set, return null when passed during the loop
 * @returns {Promise<Record<string, Array<number>> | null>}
 */
const readAndDrainTouchData = async (options = {}) => {
  await sleep(MULTI_TOUCH_WINDOW_MS)
  /** @type {Record<string, number>} */
  const valueByAddress = {}
  for (const addr of digitizer.addresses) {
    const key = `0x${addr.toString(16)}`
    const buf = await readRegister(digitizer.R.INTF, 6, addr)
    valueByAddress[key] = (buf.readUint16LE() & buf.readUint16LE(2)) | buf.readUint16LE(4)
  }
  let cnt = 0
  do {
    if (options.deadline != null && Date.now() >= options.deadline) return null
    for (const addr of digitizer.addresses) {
      const key = `0x${addr.toString(16)}`
      const buf = await readRegister(digitizer.R.GPIO, 2, addr)
      valueByAddress[key] |= buf.readUint16LE()
    }
    await sleep(CAPTURE_SLEEP_MS)
    if (cnt > CAPTURE_WINDOW_MS / CAPTURE_SLEEP_MS) {
      await disableDigitizerInterrupts()
    } else {
      cnt++
    }
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
 * Arm capture, then poll every TEST_POLL_MS until the software interrupt flag is set or
 * timeoutSec elapses. On interrupt, runs readAndDrainTouchData with the same absolute deadline.
 * Returns null on wait timeout or on capture timeout inside readAndDrainTouchData.
 * @param {number} timeoutSec Maximum seconds to wait for the first interrupt
 * @returns {Promise<Record<string, any | null>>}
 */
const runPollUntilInterrupt = async (timeoutSec) => {
  await initDigitizerForCapture()
  const deadline = Date.now() + timeoutSec * 1000
  for (; ;) {
    await sleep(TEST_POLL_MS)
    if (Date.now() >= deadline) return null
    if (gpio.getInterruptFlag()) break
  }
  const touchData = await readAndDrainTouchData({ deadline })
  if (!touchData) {
    return null
  }
  let position
  try {
    position = touchDataToDigitizerXY(touchData)
  } catch (e) {
    console.warn(e.message)
  }
  return {
    touchData,
    position
  }
}

/**
 * Disable GPINTEN on all MCPs (interrupt-on-change off).
 */
const disableDigitizerInterrupts = async () => {
  for (const addr of digitizer.addresses) {
    await writeRegister(digitizer.R.GPINTEN, [0, 0], addr)
  }
}

/**
 * Read GPIO on all MCPs in a loop until the software interrupt flag clears.
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
 * (x, y) in digitizer-local coordinates (mm from digitizer origin).
 * touchData is { r: number[], c: number[] }
 * @param {{ r?: number[], c?: number[] }} touchData bits-by-target from `readAndDrainTouchData`
 * @returns {{ x: number, y: number }} position relative to digitizer origin (x from cols, y from rows)
 */
const touchDataToDigitizerXY = (touchData) => {
  const PITCH_MM = 5.08
  const rows = touchData.r ?? []
  const cols = touchData.c ?? []
  if (
    rows.length === 0 ||
    rows.length > 2 ||
    rows.length === 2 && Math.abs(rows[1] - rows[0]) !== 1 ||
    cols.length === 0 ||
    cols.length > 2 ||
    cols.length === 2 && Math.abs(cols[1] - cols[0]) !== 1
  ) {
    throw new Error('Calibration: touch coordinates cannot be determined')
  }
  const rowCenter = rows.reduce((a, b) => a + b, 0) / rows.length
  const colCenter = cols.reduce((a, b) => a + b, 0) / cols.length
  return { x: colCenter * PITCH_MM, y: rowCenter * PITCH_MM }
}

export {
  runPollUntilInterrupt,
  clearDigitizerInterrupt,
  initDigitizerForCapture,
  disableDigitizerInterrupts,
  readAndDrainTouchData,
  touchDataToDigitizerXY
}
