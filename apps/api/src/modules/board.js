import * as servo from '@/modules/servo.js'
import { IKK } from '@/modules/kinematics.js'
import config from '@/config.json' with {type: 'json'}
import { sleep } from './utils.js'

const figures = Object.keys(config.figures)

const release = async () => {
  await servo.setChannel({
    channel: config.board.grabberChannel,
    pulseWidthUs: config.board.release
  })
}

const grab = async () => {
  await servo.setChannel({
    channel: config.board.grabberChannel,
    pulseWidthUs: config.board.grab
  })
}

/**
 * @param {KinematicsOutput} to 
 * @param {{
 *   descentLength?: number
 *   vMaxDegPerSec?: number
 *   delay?: number
 * }} [options] 
 */
const descent = async (to, options) => {
  const {
    descentLength = 50,
    vMaxDegPerSec,
    delay,
  } = options ?? {}
  const preTarget = {
    ...to,
    z: to.z + descentLength
  }
  await servo.toPoint(IKK(preTarget), [], {
    relax: false,
    vMaxDegPerSec
  })
  await sleep(delay)
  await servo.line(preTarget, { x: 0, y: 0, z: -descentLength })
}

/**
 * @param {KinematicsOutput} to 
 * @param {{
 *   liftLength?: number
 *   maxSpeed?: number
 * }} [options] 
 */
const lift = async (to, options) => {
  const {
    liftLength = 50,
    maxSpeed = 2
  } = options ?? {}
  await servo.toPoint(IKK(to), [], { relax: false })
  await servo.line(to, { x: 0, y: 0, z: liftLength }, { maxSpeed })
}

/**
 * @param {KinematicsOutput} to
 * @param {{
 *   delta: number
 * }} [options] 
 */
const search = async (to, options) => {
  let { x, y, z } = to
  const {
    delta = 10,
  } = options ?? {}
  const via = [
    [0, 0, delta],
    [0, 0, 0],
    [0, 0, delta],
    // --
    [-delta, -delta, delta],
    [-delta, -delta, 0],
    [-delta, -delta, delta],
    // --
    [+delta, -delta, delta],
    [+delta, -delta, 0],
    [+delta, -delta, delta],
    // --
    [+delta, +delta, delta],
    [+delta, +delta, 0],
    [+delta, +delta, delta],
    // --
    [-delta, +delta, delta],
    [-delta, +delta, 0],
    [-delta, +delta, delta],
  ].map(
    ([dx, dy, dz]) => IKK({ x: x + dx, y: y + dy, z: z + dz })
  )
  await servo.toPoint(IKK({ x, y, z }), via, { relax: false, vMaxDegPerSec: 10 })
}

/**
 * Picks up and moves a piece `from` to `to` and returns to `home`
 * @param {string} fromNotation
 * @param {string} toNotation
 * @param {keyof Figures} figure
 * @param {{
 *   liftLength?: number
 * }} [options] 
 */
const move = async (fromNotation, toNotation, figure, options) => {
  const {
    liftLength = 50,
  } = options ?? {}
  const height = config.figures[figure].height
  const from = notationToPosition(fromNotation)
  const to = notationToPosition(toNotation)
  Object.assign(from, {
    z: from.z + height
  })
  Object.assign(to, {
    z: to.z + height
  })
  await descent(from, { vMaxDegPerSec: 30, delay: 2000 })
  await sleep(1000)
  await grab()
  await sleep(1000)
  await lift(from, { liftLength })
  await sleep(1000)
  await descent(to, { vMaxDegPerSec: 15, delay: 3000 })
  await sleep(1000)
  await release()
  await lift(to, { liftLength })
  await servo.toPoint(servo.getPosition('home'), [], { relax: true })
}

/**
 * Takes chess board notation, e.g. `c3` and returns `{x,y,z}` of the cell center at board height
 * @param {string} notation
 * @returns {KinematicsOutput}
 */
const notationToPosition = notation => {
  const { originOffset, cellSize } = config.board
  if (
    typeof notation !== 'string' ||
    notation.length !== 2
  ) {
    throw new Error(`Invalid notation: ${notation}, not a string`)
  }
  const { rank, file } = notation.toLowerCase().match(/^(?<file>[a-h])(?<rank>[1-8])$/)?.groups ?? {}
  if (!rank || !file) {
    throw new Error(`Invalid notation: ${notation}, must match /^[a-h][1-8]$/`)
  }
  const x = Math.round(originOffset[0] + (Number(rank) - 1) * cellSize + cellSize * 0.5)
  const y = Math.round(originOffset[1] - (file.charCodeAt(0) - 'a'.charCodeAt(0)) * cellSize - cellSize * 0.5)
  const z = originOffset[2]
  return { x, y, z }
}

const home = async () => {
  await servo.toPoint(servo.getPosition('home'))
}

export {
  figures,
  home,
  notationToPosition,
  move,
  search,
  grab,
  release,
  descent,
  lift
}