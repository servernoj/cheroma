/**
 * GPIO interrupt line watcher. Watches the configured pin (e.g. INT from MCP23017,
 * open-drain, active low): sets flag on falling edge, clears flag on rising edge.
 */
import { Gpio } from '@/gpio-stub.js'
import config from '@/config.json' with { type: 'json' }

const intPin = config.drivers?.gpio?.intPin
if (intPin == null || typeof intPin !== 'number') {
  throw new Error('config.drivers.gpio.intPin is required and must be a number')
}

let gpio = null
let interruptFlag = false

/**
 * Whether an interrupt is currently asserted (INT line low since last rising edge).
 * Cleared automatically when the INT line goes high again (rising edge).
 * @returns {boolean}
 */
const getInterruptFlag = () => interruptFlag

/**
 * Start watching the interrupt GPIO pin (both edges). Sets flag on falling edge,
 * clears flag on rising edge.
 * @returns {void}
 */
const startWatch = () => {
  gpio = new Gpio(intPin, 'in', 'both')
  gpio.watch((err, value) => {
    if (!err) interruptFlag = value === 1 ? false : true
  })
}

/**
 * Stop watching and release the GPIO. Call on shutdown.
 * @returns {void}
 */
const stopWatch = () => {
  if (gpio) {
    try {
      if (typeof gpio.unwatchAll === 'function') gpio.unwatchAll()
      if (typeof gpio.close === 'function') gpio.close()
    } catch (_) {
      // -- NOP
    }
    gpio = null
  }
  interruptFlag = false
}

export { startWatch, stopWatch, getInterruptFlag, intPin }
