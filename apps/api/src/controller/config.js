import express from 'express'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import * as config from '@/modules/config.js'

const router = express.Router()

const optionsSchema = z.object({
  debug: z.boolean()
})
const fittingSchema = z.object({
  roll: z.number(),
  pitch: z.number(),
  yaw: z.number(),
  t: z.tuple([z.number(), z.number(), z.number()])
})
const servoFittingSchema = z.object({
  scale: z.number(),
  offset: z.number()
})
const servoSchema = z.record(
  z.enum(['base', 'shoulder', 'elbow', 'wrist']),
  z.object({
    fitting: servoFittingSchema
  }).optional()
)
const boardSchema = z.object({
  originOffset: z.record(
    z.enum(['x', 'y', 'z']),
    z.number()
  ),
  cellSize: z.number(),
  basket: z.record(
    z.enum(['x', 'y', 'z']),
    z.number()
  )
}).partial()
const geomSchema = z.record(
  z.enum(['H', 'L1', 'L2', 'L3', 'dX']),
  z.number().optional()
)

const configSchema = z.object({
  options: optionsSchema,
  fitting: fittingSchema,
  servos: servoSchema,
  board: boardSchema,
  geom: geomSchema
}).partial()

router.get(
  '/',
  async (req, res) => {
    const c = config.retrieve()
    res.json(c)
  }
)

router.patch(
  '/',
  validator({
    body: configSchema
  }),
  async (req, res) => {
    const c = config.update(res.locals.parsed.body)
    res.json(c)
  }
)

router.delete(
  '/',
  async (req, res) => {
    const c = config.reset()
    res.json(c)
  }
)

router.post(
  '/',
  async (req, res) => {
    const c = await config.save()
    res.json(c)
  }
)


export default router