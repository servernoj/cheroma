/**
 * GPIO interrupt line watcher. Watches the configured pin (e.g. INT from MCP23017,
 * open-drain, active low): sets flag on falling edge, clears flag on rising edge.
 */
import { Gpio } from '@/gpio-stub.js'
import { subscribe } from '@/modules/config.js'

let intPin

subscribe(config => {
  intPin = config.drivers?.gpio?.intPin
  if (intPin == null || typeof intPin !== 'number') {
    throw new Error('config.drivers.gpio.intPin is required and must be a number')
  }
}, { immediate: true })

let gpio = null
let interruptFlag = false

/**
 * Whether an interrupt is currently asserted (INT line low since last rising edge).
 * Cleared automatically when the INT line goes high again (rising edge), or by clearInterruptFlag() after consuming.
 * @returns {boolean}
 */
const getInterruptFlag = () => interruptFlag

/**
 * Clear the interrupt flag. Call after reading MCP GPIO so the next poll cycle doesn't see a stale true
 * (the callback that clears on rising edge may run after we've already returned the response).
 * @returns {void}
 */
const clearInterruptFlag = () => {
  interruptFlag = false
}

/**
 * Start watching the interrupt GPIO pin (both edges). Sets flag on falling edge,
 * clears flag on rising edge.
 * @returns {void}
 */
const startWatch = () => {
  gpio = new Gpio(intPin, 'in', 'both', { bias: 'pull-up' })
  gpio.watch((err, value) => {
    if (!err) {
      interruptFlag = value === 1 ? false : true
    } else {
      console.error(err)
    }
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
    } catch {
      // -- NOP
    }
    gpio = null
  }
  interruptFlag = false
}

export { startWatch, stopWatch, getInterruptFlag, clearInterruptFlag, intPin }
