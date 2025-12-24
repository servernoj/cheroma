import os from 'os'

let i2c
if (os.platform() === 'linux') {
  i2c = await import('i2c-bus')
} else {
  i2c = {
    openPromisified: async () => ({
      readByte: async () => 0,
      writeByte: async () => { },
      i2cWrite: async () => { },
      close: async () => { },
    }),
  }
}
export default i2c
