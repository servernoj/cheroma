/**
 * GPIO stub: real @bratbit/onoff on Linux, no-op mock elsewhere (e.g. macOS).
 * Use this instead of importing @bratbit/onoff directly so the app runs without
 * native GPIO on non-Linux.
 */
import os from 'os'

let Gpio

/** Mock Gpio: constructor and methods no-op, no native dependency */
class MockGpio {
  constructor (_gpio, _direction, _edge, _options) {}
  watch (_callback) {}
  unwatchAll () {}
  close () {}
  get unexport () {
    return this.close.bind(this)
  }
}

if (os.platform() === 'linux') {
  try {
    const onoff = await import('@bratbit/onoff')
    Gpio = onoff.Gpio
  } catch {
    Gpio = MockGpio
  }
} else {
  Gpio = MockGpio
}

export { Gpio }
