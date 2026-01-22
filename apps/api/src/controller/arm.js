import express from 'express'
import { IK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import { sleep } from '@/modules/utils.js'


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

router.post(
  '/home-then-to',
  validator({
    body: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    })
  }),
  async (req, res) => {
    const { x, y, z } = res.locals.parsed.body
    await servo.toHome({ slow: true, relax: false })
    await sleep(700)
    const above = IK({ x, y, z: z + 50 })
    await servo.toPoint({
      base: above.q0,
      shoulder: above.q1,
      elbow: above.q2,
      wrist: above.q3
    }, { relax: false })
    const target = IK({ x, y, z })
    await sleep(700)
    await servo.toPoint({
      base: target.q0,
      shoulder: target.q1,
      elbow: target.q2,
      wrist: target.q3
    }, { relax: true })
    res.sendStatus(200)
  }
)


export default router