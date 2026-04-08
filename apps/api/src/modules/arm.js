import { IKK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import { sleep } from '@/modules/utils.js'
import { subscribe } from '@/modules/config.js'

/** @type {Board} */
let board

subscribe(config => {
  board = config.board
}, { immediate: true })

/**
 * Move the arm to predefined pose ('init' or 'home'
 * @param {'init' | 'home'} pose 
 * @param {{relax: boolean}} [options]
 */
const toPose = async (pose, options) => {
  const {
    relax = true
  } = options ?? {}
  await servo.toPoint(servo.getPosePosition(pose), [], { relax })
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

const release = async () => {
  await servo.setChannel({
    channel: board.grabberChannel,
    pulseWidthUs: board.release
  })
}

const grab = async () => {
  await servo.setChannel({
    channel: board.grabberChannel,
    pulseWidthUs: board.grab
  })
}

export {
  toPose,
  search,
  descent,
  lift,
  release,
  grab
}