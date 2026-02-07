import * as servo from '@/modules/servo.js'
import { IK, toModel, K2S, } from '@/modules/kinematics.js'
import config from '@/config.json' with {type: 'json'}

const open = async () => {
  await servo.setChannel({
    channel: config.board.gripperChannel,
    pulseWidthUs: config.board.open
  })
}

const close = async () => {
  await servo.setChannel({
    channel: config.board.gripperChannel,
    pulseWidthUs: config.board.close
  })
}

const drop = async () => {
  const target = config.board.basket
  const preTarget = {
    ...target,
    z: target.z + 100
  }
  await servo.toPoint(
    K2S(IK(toModel(target))),
    [
      K2S(IK(toModel(preTarget)))
    ]
  )
  await open()
}

export {
  open,
  close,
  drop
}