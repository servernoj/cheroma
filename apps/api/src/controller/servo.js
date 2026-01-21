import express from 'express'
import * as servo from '@/modules/servo.js'
import config from '@/config.json' with {type: 'json'}
import { validator } from '@/controller/mw/index.js'
import z from 'zod'


const router = express.Router()

router.post(
  '/home',
  validator({
    query: z.object({
      slow: z.boolean().default(true)
    })
  }),
  async (req, res) => {
    const { slow } = res.locals.parsed.query
    await servo.toHome(slow)
    res.sendStatus(200)
  }
)

router.post(
  '/relax',
  validator({
    body: z.object({
      servos: z.enum(Object.keys(config.servos)).array().min(0).optional()
    }).optional()
  }),
  async (req, res) => {
    const { servos } = res.locals.parsed.body ?? {}
    await servo.relax(servos)
    res.sendStatus(200)
  }
)

router.post(
  '/channel',
  validator({
    body: z.object({
      channel: z.number().int().max(5).min(0),
      pulseWidthUs: z.number().default(0),
    })
  }),
  async (req, res) => {
    const { channel, us: pulseWidthUs } = res.locals.parsed.body
    await servo.setChannel({ channel, pulseWidthUs })
    res.sendStatus(200)
  }
)
router.post(
  '/to',
  validator({
    body: z.object({
      base: z.number(),
      shoulder: z.number(),
      elbow: z.number(),
      wrist: z.number(),
    }),
  }),
  async (req, res) => {
    await servo.toPoint(res.locals.parsed.body)
    res.sendStatus(200)
  }
)



export default router