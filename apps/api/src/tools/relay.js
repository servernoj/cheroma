import i2c from '@/i2c-stub.js'
import { sleep } from './index.js'

const deviceAddr = 0x18
const commands = {
  on: Buffer.from([0x01]),
  off: Buffer.from([0x00])
}

export const on_off = async () => {
  const bus = await i2c.openPromisified(1)
  await bus.i2cWrite(deviceAddr, commands.on.length, commands.on)
  await sleep(3000)
  await bus.i2cWrite(deviceAddr, commands.off.length, commands.off)
  await bus.close()
}