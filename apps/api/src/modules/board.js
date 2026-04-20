import * as servo from '@/modules/servo.js'
import * as arm from '@/modules/arm.js'
import { subscribe } from '@/modules/config.js'
import { sleep } from './utils.js'

/** @type {Pieces} */
let pieces
/** @type {Board} */
let board

subscribe(config => {
  pieces = config.pieces
  board = config.board
}, { immediate: true })


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
  const height = pieces?.[args.piece.toLowerCase()]?.height ?? 100
  const from = notationToPosition(args.from)
  const to = args.to === 'basket'
    ? board.basket
    : notationToPosition(args.to)
  Object.assign(from, {
    z: from.z + height
  })
  Object.assign(to, {
    z: to.z + height
  })
  await arm.descent(from, { vMaxDegPerSec: 60, elevation, delay: 2000 })
  await sleep(1000)
  await arm.grab()
  // await arm.search(from, { delta: 5, vMaxDegPerSec: 20 })
  // await sleep(1000)
  await arm.lift(from, { elevation })
  // await sleep(1000)
  await arm.descent(to, { vMaxDegPerSec: 45, elevation, delay: 3000 })
  // await sleep(1000)
  await arm.release()
  await arm.lift(to, { elevation })
  await servo.toPoint(servo.getPosePosition('home'), [], { relax: true })
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
 * @returns {KinematicsOutput}
 */
const notationToPosition = (notation) => {
  const { originOffset, cellSize } = board
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
  // --
  const x = Math.round(originOffset.x + (rankNum - 1) * cellSize + cellSize * 0.5)
  const y = Math.round(originOffset.y - fileIdx * cellSize - cellSize * 0.5)
  const z = originOffset.z
  return { x, y, z }
}

const to = async (notation, height) => {
  const { x, y, z } = notationToPosition(notation)
  await arm.toPose('home')
  await arm.descent({
    x,
    y,
    z: z + height
  }, { vMaxDegPerSec: 30 })
}

export {
  to,
  notationToPosition,
  move,
  remove,
}