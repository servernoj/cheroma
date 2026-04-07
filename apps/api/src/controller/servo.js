import express from 'express'
import * as servo from '@/modules/servo.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.post(
  '/home',
  async (req, res) => {
    await servo.toPoint(servo.getPosition('home'), [], { relax: true })
    res.sendStatus(200)
  }
)
router.post(
  '/init',
  async (req, res) => {
    await servo.toPoint(servo.getPosition('init'), [], { relax: true })
    res.sendStatus(200)
  }
)

router.post(
  '/relax',
  async (req, res) => {
    await servo.doRelax()
    res.sendStatus(200)
  }
)

router.post(
  '/channel',
  validator({
    body: z.object({
      channel: z.number().int().max(7).min(0),
      pulseWidthUs: z.number().default(0),
    })
  }),
  async (req, res) => {
    const { channel, pulseWidthUs } = res.locals.parsed.body
    await servo.setChannel({ channel, pulseWidthUs })
    res.sendStatus(200)
  }
)

export default router