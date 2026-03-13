import express from 'express'
import { runCalibrationSequence } from '@/modules/calibration.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

const originSchema = z.tuple([z.number(), z.number(), z.number()])
const gridSchema = z.object({
  rows: z.number().int().min(1).max(32),
  cols: z.number().int().min(1).max(32)
})

router.post(
  '/',
  validator({
    body: z.object({
      origin: originSchema,
      grid: gridSchema,
      stepMm: z.number().positive().finite()
    })
  }),
  async (req, res) => {
    const { origin, grid, stepMm } = res.locals.parsed.body
    // data: number[][] — each row [q0, q1, q2, q3, x, y, z] for the fitting algorithm
    const data = await runCalibrationSequence(origin, grid, stepMm)
    res.json({ data })
  }
)

export default router
