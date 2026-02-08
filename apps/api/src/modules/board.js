import * as servo from '@/modules/servo.js'
import { IK, toModel, K2S, } from '@/modules/kinematics.js'
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
  await release()
}

export {
  grab,
  release,
  drop
}