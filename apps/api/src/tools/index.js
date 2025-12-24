import * as motor from './motor.js'
import * as ota from './ota.js'
import * as buzzer from './buzzer.js'
import * as relay from './relay.js'
import * as firmware from './firmware.js'
import * as wifi from './wifi.js'
import * as system from './system.js'
import i2c from '@/i2c-stub.js'

const sleep = (ms) => new Promise(
  resolve => {
    const timer = setTimeout(
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      ms
    )
  }
)

const bus = await i2c.openPromisified(1)

const messageProcessor = async ({ target, method, args }) => {
  switch (target) {
    case 'buzzer': {
      const handler = buzzer?.[method]
      if (typeof handler === 'function') {
        await handler(...args)
      }
      break
    }
    case 'motor': {
      const handler = motor?.[method]
      if (typeof handler === 'function') {
        const result = await handler(...args)
        return result
      }
      break
    }
    case 'relay': {
      const handler = relay?.[method]
      if (typeof handler === 'function') {
        await handler(...args)
      }
      break
    }
    case 'i2c': {
      const handler = bus?.[method]
      switch (method) {
        case '_readI2cBlock': {
          const b = Buffer.alloc(4)
          const [addr, reg] = args
          await bus.readI2cBlock(addr, reg, 4, b)
          return b
        }
        default: {
          if (typeof handler === 'function') {
            const result = await handler.call(bus, ...args)
            return result
          }
        }
      }
      break
    }
    case 'tools': {
      if (method === 'sleep') {
        await sleep(args[0])
      }
      break
    }
    default:
      throw new Error(`Unknown target in request: ${target}`)
  }
}

export {
  messageProcessor,
  sleep,
  motor,
  ota,
  buzzer,
  relay,
  firmware,
  wifi,
  system
}