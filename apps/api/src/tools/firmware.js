import { readRegister } from './i2c-util.js'

export const getInfo = async () => {
  const buffer = await readRegister(0x30)
  const version = buffer.toString('utf8', 0, 32).split('\0')[0]
  const buildDate = buffer.toString('utf8', 32, 48).split('\0')[0]
  const buildTime = buffer.toString('utf8', 48).split('\0')[0]
  return {
    version,
    buildDate,
    buildTime
  }
}
