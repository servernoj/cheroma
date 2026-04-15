import express from 'express'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import * as config from '@/modules/config.js'

const router = express.Router()

const optionsSchema = z.object({
  debug: z.boolean()
})
const servoSchema = z.record(
  z.enum(['base', 'shoulder', 'elbow', 'wrist']),
  z.object({}).optional()
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
const xyCoeffsSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
const xyCorrectionSchema = z.object({
  cx: xyCoeffsSchema,
  cy: xyCoeffsSchema
}).partial()

const zCoeffsSchema = z.tuple([
  z.number(), z.number(), z.number(), z.number(), z.number(),
  z.number(), z.number(), z.number(), z.number(), z.number()
])
const zCorrectionSchema = z.object({
  cz: zCoeffsSchema
}).partial()

const configSchema = z.object({
  options: optionsSchema,
  servos: servoSchema,
  board: boardSchema,
  geom: geomSchema,
  xyCorrection: xyCorrectionSchema,
  zCorrection: zCorrectionSchema
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