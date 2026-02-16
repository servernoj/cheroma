import * as servo from '@/modules/servo.js'
import { IKK } from '@/modules/kinematics.js'
import config from '@/config.json' with {type: 'json'}

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
 * }} [options] 
 */
const descent = async (to, options) => {
  const {
    descentLength = 50,
    vMaxDegPerSec
  } = options ?? {}
  const preTarget = {
    ...to,
    z: to.z + descentLength
  }
  await servo.toPoint(IKK(preTarget), [], {
    relax: false,
    vMaxDegPerSec
  })
  await servo.line(preTarget, { x: 0, y: 0, z: -descentLength })
}

/**
 * @param {KinematicsOutput} to 
 * @param {{
 *   liftLength: number
 * }} [options] 
 */
const lift = async (to, options) => {
  const {
    liftLength = 50
  } = options ?? {}
  await servo.toPoint(IKK(to), [], { relax: false })
  await servo.line(to, { x: 0, y: 0, z: liftLength })
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
    delta = 10
  } = options ?? {}
  const via = [
    [-delta, -delta, 0],
    [+delta, -delta, 0],
    [+delta, +delta, 0],
    [-delta, +delta, 0],
    [0, 0, 0]
  ].map(
    ([dx, dy, dz]) => IKK({ x: x + dx, y: y + dy, z: z + dz })
  )
  await servo.toPoint(IKK({ x, y, z }), via, { relax: false, vMaxDegPerSec: 5 })
}

export {
  search,
  grab,
  release,
  descent,
  lift
}