import express from 'express'
import { IKK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import * as arm from '@/modules/arm.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/pose/:pose',
  validator({
    params: z.object({
      pose: z.enum(['init', 'home'])
    })
  }),
  async (req, res) => {
    const { pose } = res.locals.parsed.params
    await servo.toPoint(servo.getPosePosition(pose), [], { relax: true })
    res.sendStatus(200)
  }
)

router.post(
  '/xyz',
  validator({
    query: z.object({
      descent: z.boolean().default(false)
    }),
    body: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number()
    })
  }),
  async (req, res) => {
    const { descent } = res.locals.parsed.query
    const to = res.locals.parsed.body
    if (descent) {
      await arm.descent(to)
      await servo.doRelax()
    } else {
      await servo.toPoint(IKK(to), [], { relax: true })
    }
    res.sendStatus(200)
  }
)

router.post(
  '/grab',
  async (req, res) => {
    await arm.grab()
    res.sendStatus(200)
  }
)

router.post(
  '/release',
  async (req, res) => {
    await arm.release()
    res.sendStatus(200)
  }
)


export default router