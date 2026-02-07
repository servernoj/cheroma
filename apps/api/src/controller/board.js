import express from 'express'
import { IK, K2S, toModel } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import * as board from '@/modules/board.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import { sleep } from '@/modules/utils.js'

const router = express.Router()

router.post(
  '/grab',
  validator({
    body: z.object({
      to: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number().default(10)
      })
    })
  }),
  async (req, res) => {
    const { to } = res.locals.parsed.body
    const target = IK(toModel(to))
    const preTarget = IK(
      toModel({
        ...to,
        z: to.z + 100
      })
    )
    await servo.toPoint(K2S(preTarget), [], { relax: false })
    await board.open()
    await sleep(1000)
    await servo.toPoint(K2S(target), [], { relax: false, vMaxDegPerSec: 20 })
    await board.close()
    await sleep(1000)
    await servo.toPoint(K2S(preTarget), [], { relax: false, vMaxDegPerSec: 20 })
    await board.drop()
    await servo.toHome()
    res.sendStatus(200)
  }
)



export default router