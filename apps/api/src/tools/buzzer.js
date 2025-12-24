import i2c from '@/i2c-stub.js'
import { sleep } from './index.js'

const deviceAddr = 0x1e

export const notes = {
  FS3: 185,
  G3: 196,
  GS3: 208,
  A3: 220,
  AS3: 233,
  B3: 247,
  C4: 262,
  CS4: 277,
  D4: 294,
  DS4: 311,
  E4: 330,
  F4: 349,
  FS4: 370,
  G4: 392,
  GS4: 415,
  A4: 440,
  AS4: 466,
  B4: 494,
  C5: 523,
  CS5: 554,
  D5: 587,
  DS5: 622,
  E5: 659,
  F5: 698,
  FS5: 740,
  G5: 784,
  GS5: 831,
  A5: 880,
  AS5: 932,
  B5: 988,
  C6: 1047,
  CS6: 1109,
  D6: 1175,
  DS6: 1245,
  E6: 1319,
  F6: 1397,
  FS6: 1480,
  G6: 1568,
  GS6: 1661,
  A6: 1760,
  AS6: 1865,
  B6: 1976,
  C7: 2093,
  CS7: 2217,
  D7: 2349,
  DS7: 2489,
  E7: 2637,
  F7: 2794,
  FS7: 2960,
  G7: 3136,
  GS7: 3322,
  A7: 3520,
  AS7: 3729,
  B7: 3951,
  C8: 4186,
  CS8: 4435,
  D8: 4699,
  DS8: 4978,
  REST: 0
}
export const melodies = {
  mario: [
    { note: 'E5', length: 125 },
    { note: 'REST', length: 25 },
    { note: 'E5', length: 125 },
    { note: 'REST', length: 125 },
    { note: 'E5', length: 125 },
    { note: 'REST', length: 125 },
    { note: 'C5', length: 125 },
    { note: 'E5', length: 125 },
    { note: 'REST', length: 125 },
    { note: 'G5', length: 125 },
    { note: 'REST', length: 375 },
    { note: 'G4', length: 250 }
  ],
  seven: [
    { note: 'E4', length: 500 },
    { note: 'REST', length: 125 },
    { note: 'E4', length: 125 },
    { note: 'REST', length: 50 },
    { note: 'G4', length: 187 },
    { note: 'REST', length: 50 },
    { note: 'E4', length: 187 },
    { note: 'REST', length: 50 },
    { note: 'D4', length: 125 },
    { note: 'C4', length: 500 },
    { note: 'REST', length: 50 },
    { note: 'B3', length: 500 }
  ]
}

/**
 * @param {Array<{note: string, length: number}>} profile A sequence of notes + lengths (ms) to sound
 * @param {boolean} [blocking] Flag allowing to block the flow while current note is playing
 */
export const runProfile = async (profile = [], blocking = true) => {
  const bus = await i2c.openPromisified(1)
  const buf = Buffer.alloc(8)
  const payload = profile.reduce(
    (acc, { note, length }) => {
      const freq = notes?.[note] ?? 0
      buf.writeUInt32LE(freq)
      buf.writeUInt32LE(length, 4)
      acc.push([length, Buffer.from(buf)])
      return acc
    },
    []
  )
  for (const [delay, data] of payload) {
    await bus.i2cWrite(deviceAddr, data.length, data)
    if (blocking) {
      await sleep(delay - 5)
    }
  }
  await bus.close()
}