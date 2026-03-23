import * as servo from '@/modules/servo.js'
import { IKK } from '@/modules/kinematics.js'
import config from '@/config.json' with {type: 'json'}
import { sleep } from './utils.js'

const pieces = Object.keys(config.pieces)

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
  const logPoint = IKK(to)
  console.log(Object.values(logPoint).map(v => Math.round(v * 100) / 100))

  await servo.toPoint(IKK(preTarget), [], {
    relax: false,
    vMaxDegPerSec
  })
  await sleep(delay)
  await servo.line(preTarget, { x: 0, y: 0, z: -elevation })
  await servo.doRelax()
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
 * @param {{from: string, to: string, piece: string}} args
 * @param {{
 *   elevation?: number
 * }} [options] 
 */
const move = async (args, options) => {
  const {
    elevation = 100,
  } = options ?? {}
  const height = config.pieces[args.piece].height
  const from = notationToPosition(args.from)
  const to = args.to === 'basket'
    ? config.board.basket
    : notationToPosition(args.to)
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
 * Picks up a piece and removes it from the board, then returns to `home`
 * @param {{from: string, piece: string}} args
 * @param {{
 *   elevation?: number
 * }} [options] 
 */
const remove = async (args, options) => {
  await move({
    ...args,
    to: 'basket',
  }, options)
}

/**
 * Takes chess board notation, e.g. `c3` and returns `{x,y,z}` of the cell center at board height
 * @param {string} notation
 * @param {{
 *   correction?: boolean
 * }} [options]
 * @returns {KinematicsOutput}
 */
const notationToPosition = (notation, options) => {
  const {
    correction = false
  } = options ?? {}
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
  // correction to address non-square shapes of cells in 4th rank
  const fileIdx = file.charCodeAt(0) - 'a'.charCodeAt(0)
  const rankNum = Number(rank)
  const deficit = 2 - fileIdx * 1 / 7
  const xCorrection = correction && rankNum > 3
    ? -deficit * (rankNum > 4 ? 1 : 0.5)
    : 0
  // --
  const x = Math.round(originOffset.x + (rankNum - 1) * cellSize + cellSize * 0.5 + xCorrection)
  const y = Math.round(originOffset.y - fileIdx * cellSize - cellSize * 0.5)
  const z = originOffset.z
  return { x, y, z }
}

/**
 * @param {*} [options]
 */
const home = async (options) => {
  await servo.toPoint(servo.getPosition('home'), options)
}

export {
  pieces,
  home,
  notationToPosition,
  move,
  remove,
  search,
  grab,
  release,
  descent,
  lift
}