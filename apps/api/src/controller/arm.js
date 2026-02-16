import express from 'express'
import { IKK } from '@/modules/kinematics.js'
import * as servo from '@/modules/servo.js'
import * as board from '@/modules/board.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/descent',
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
    await board.descent(to)
    await servo.doRelax()
    res.sendStatus(200)
  }
)

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
    await servo.toPoint(IKK(to), [], { relax: true })
    res.sendStatus(200)
  }
)


export default router