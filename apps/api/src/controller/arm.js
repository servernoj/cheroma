import express from 'express'
import { IK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'


const router = express.Router()

router.post(
  '/to',
  validator({
    body: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    })
  }),
  async (req, res) => {
    const { x, y, z } = res.locals.parsed.body
    const { q0, q1, q2, q3 } = IK({ x, y, z })
    await servo.toPoint({
      base: q0,
      shoulder: q1,
      elbow: q2,
      wrist: q3
    })
    res.sendStatus(200)
  }
)


export default router