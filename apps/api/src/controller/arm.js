import express from 'express'
import { IK, K2S } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/to',
  validator({
    body: z.object({
      to: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      })
    })
  }),
  async (req, res) => {
    const { to } = res.locals.parsed.body
    const target = IK(to)
    await servo.toPoint(K2S(target), [], { relax: true })
    res.sendStatus(200)
  }
)

router.post(
  '/down-to',
  validator({
    body: z.object({
      to: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }),
      via: z.object({
        base: z.number(),
        shoulder: z.number(),
        elbow: z.number(),
        wrist: z.number(),
        spinner: z.number()
      }).array().min(0).optional()
    })
  }),
  async (req, res) => {
    const { to, via = [] } = res.locals.parsed.body
    const target = IK(to)
    console.log(Object.values(target).map(p => Math.round(p * 100) / 100))
    await servo.toPoint(K2S(target), [
      ...via,
    ], { relax: true })
    res.sendStatus(200)
  }
)

export default router