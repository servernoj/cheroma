import { writeRegister } from './i2c-util.js'

/**
 * @param {string} ssid WiFi SSID
 * @param {string} password WiFi password
 */
export const setCredentials = async (ssid = '', password = '') => {
  if (!ssid || ssid.length === 0) {
    console.error(`Invalid SSID: ${ssid}`)
    return
  }
  
  // Format: ssid\0password\0
  const ssidBuffer = Buffer.from(ssid, 'utf8')
  const passwordBuffer = Buffer.from(password, 'utf8')
  
  // Total: ssid + null + password + null = ssid.length + password.length + 2
  // Must fit in 63 bytes (64 - 1 for register address)
  if (ssidBuffer.length + passwordBuffer.length + 2 > 63) {
    console.error(
      `Combined credentials too long: ${ssidBuffer.length + passwordBuffer.length + 2} bytes, max 63`
    )
    return
  }
  
  // Concatenate: ssid\0password\0
  const credBuffer = Buffer.concat([
    ssidBuffer,
    Buffer.from([0x00]),
    passwordBuffer,
    Buffer.from([0x00])
  ])
  
  await writeRegister(0x40, credBuffer)
}
