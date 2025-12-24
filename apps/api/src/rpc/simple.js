const ADDR = 0x12

const REGS = {
  STATUS: 0x03,
}
const BITS = {
  ST_AVAILABLE: 0x02,
  ST_REM: 0x04,
  ST_DET: 0x08,
  CLEAR: 0x0E
}

export default (rpcRequest, {
  threshold = 5,
  isEnabled = false,
  demoIntervalSec = 0
}) => {
  const onActive = async () => {
    // const { factor } = await rpcRequest({ target: 'motor', method: 'getConfig', args: [] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [1] })
    await rpcRequest({ target: 'motor', method: 'release', args: [] })
    await rpcRequest({ target: 'tools', method: 'sleep', args: [4_000] })
    await rpcRequest({ target: 'motor', method: 'runProfile', args: [[{ degrees: +90, delay: 0 }, { degrees: -90, delay: 0 }], 8] })
    await rpcRequest({ target: 'tools', method: 'sleep', args: [2_000] })
    await rpcRequest({ target: 'relay', method: 'on_off', args: [] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [2] })
    await rpcRequest({ target: 'motor', method: 'freeRun', args: [-1] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [factor] })
    await rpcRequest({ target: 'tools', method: 'sleep', args: [120_000] })
  }
  const onIdleForTooLong = async () => {
    // const { factor } = await rpcRequest({ target: 'motor', method: 'getConfig', args: [] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [1] })
    await rpcRequest({ target: 'motor', method: 'release', args: [] })
    await rpcRequest({ target: 'tools', method: 'sleep', args: [4_000] })
    await rpcRequest({ target: 'motor', method: 'runProfile', args: [[{ degrees: +90, delay: 0 }, { degrees: -90, delay: 0 }], 4] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [2] })
    await rpcRequest({ target: 'motor', method: 'freeRun', args: [-1] })
    // await rpcRequest({ target: 'motor', method: 'config', args: [factor] })
  }
  const readByte = async (reg) => {
    const result = await rpcRequest({
      target: 'i2c',
      method: 'readByte',
      args: [ADDR, reg]
    })
    return result
  }
  const readU32LE = async (reg) => {
    const b = await rpcRequest({
      target: 'i2c',
      method: '_readI2cBlock',
      args: [ADDR, reg]
    })
    return Buffer.from(b).readUInt32LE()
  }
  const writeByte = async (reg, byte) => {
    await rpcRequest({
      target: 'i2c',
      method: 'writeByte',
      args: [ADDR, reg, byte]
    })
  }
  let isDetPrev = 0
  let cnt = 0
  let isActive = false
  let lastActivityTs = Date.now()
  return async () => {
    if (isActive) {
      lastActivityTs = Date.now()
      return
    }
    const idleTime = Date.now() - lastActivityTs
    if (demoIntervalSec && idleTime > demoIntervalSec * 1000) {
      isActive = true
      onIdleForTooLong().then(
        () => {
          isActive = false
        }
      )
    }
    const status = await readByte(REGS.STATUS)
    const [isDet, isAvailable] = [
      status & BITS.ST_DET ? 1 : 0,
      status & BITS.ST_AVAILABLE ? 1 : 0
    ]
    if (isDet && isDetPrev) {
      cnt++
    }
    if (!isDet && isDetPrev) {
      // -- falling edge on isDet
      if (isEnabled && cnt > threshold) {
        isActive = true
        console.log('>>>')
        onActive().then(
          () => {
            isActive = false
            console.log('<<<')
          }
        )
      }
      console.log('+++', cnt)
      cnt = 0
    }
    if (isAvailable) {
      await writeByte(REGS.STATUS, status & (~BITS.CLEAR))
    }
    isDetPrev = isDet
  }
}