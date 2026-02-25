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
 *   elevation?: number
 *   vMaxDegPerSec?: number
 *   delay?: number
 * }} [options] 
 */
const descent = async (to, options) => {
  const {
    elevation = 50,
    vMaxDegPerSec,
    delay,
  } = options ?? {}
  const preTarget = {
    ...to,
    z: to.z + elevation
  }
  await servo.toPoint(IKK(preTarget), [], {
    relax: false,
    vMaxDegPerSec
  })
  await sleep(delay)
  await servo.line(preTarget, { x: 0, y: 0, z: -elevation })
}

/**
 * @param {KinematicsOutput} to 
 * @param {{
 *   elevation?: number
 *   maxSpeed?: number
 * }} [options] 
 */
const lift = async (to, options) => {
  const {
    elevation = 50,
  } = options ?? {}
  await servo.toPoint(IKK(to), [], { relax: false })
  await servo.line(to, { x: 0, y: 0, z: elevation })
}

/**
 * @param {KinematicsOutput} at
 * @param {{
 *   delta?: number
 *   vMaxDegPerSec?: number
 * }} [options] 
 */
const search = async (at, options) => {
  let { x, y, z } = at
  const {
    delta = 5,
    vMaxDegPerSec = 20
  } = options ?? {}
  const via = [
    [0, 0, 0],
    [-delta, -delta, 0],
    [0, 0, 0],
    [-delta, +delta, 0],
    [0, 0, 0],
    [+delta, +delta, 0],
    [0, 0, 0],
    [+delta, -delta, 0],
    [0, 0, 0]
  ].map(
    ([dx, dy, dz]) => IKK({ x: x + dx, y: y + dy, z: z + dz })
  )
  await servo.toPoint(IKK({ x, y, z }), via, { vMaxDegPerSec, relax: false })
}

/**
 * Picks up and moves a piece `from` to `to` and returns to `home`
 * @param {string} fromNotation
 * @param {string} toNotation
 * @param {keyof Figures} figure
 * @param {{
 *   elevation?: number
 * }} [options] 
 */
const move = async (fromNotation, toNotation, figure, options) => {
  const {
    elevation = 100,
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
  await descent(from, { vMaxDegPerSec: 60, elevation, delay: 2000 })
  await sleep(1000)
  await grab()
  await search(from, { delta: 5, vMaxDegPerSec: 20 })
  await sleep(1000)
  await lift(from, { elevation })
  await sleep(1000)
  await descent(to, { vMaxDegPerSec: 45, elevation, delay: 3000 })
  await sleep(1000)
  await release()
  await lift(to, { elevation })
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