import express from 'express'
import * as digitizer from '@/modules/digitizer.js'
import { addresses as mcpAddresses } from '@/modules/drivers/digitizer.js'
import { readRegister, writeRegister } from '@/modules/i2c.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

const hexNum = z.union([z.string(), z.number()]).transform((v) =>
  typeof v === 'string' ? parseInt(v, 16) : v
).refine((n) => !Number.isNaN(n) && Number.isInteger(n), { message: 'Invalid hex or number' })
const addrSchema = hexNum.refine((a) => mcpAddresses.includes(a), { message: 'Address must be one of configured MCP23017 addresses' })
const regSchema = hexNum.refine((r) => r >= 0 && r <= 0xff, { message: 'Register must be 0x00–0xff' })

router.get(
  '/test',
  validator({
    query: z.object({
      timeout_sec: z.number().positive().finite()
    })
  }),
  async (req, res) => {
    const { timeout_sec: timeoutSec } = res.locals.parsed.query
    const data = await digitizer.runPollUntilInterrupt(timeoutSec)
    if (data === null) {
      res.status(408).json({
        error: 'Timeout',
        message: `No interrupt within ${timeoutSec}s`
      })
      return
    }
    res.json(data)
  }
)

router.get(
  '/mcp',
  validator({
    query: z.object({
      address: addrSchema,
      register: regSchema,
      length: z.number().int().min(1).max(32).optional().default(2)
    })
  }),
  async (req, res) => {
    const { address, register, length } = res.locals.parsed.query
    const buf = await readRegister(register, length, address)
    res.json({ address, register, data: [...buf] })
  }
)

router.post(
  '/mcp',
  validator({
    body: z.object({
      address: addrSchema,
      register: regSchema,
      data: z.array(z.number().int().min(0).max(0xff)).min(1).max(32)
    })
  }),
  async (req, res) => {
    const { address, register, data } = res.locals.parsed.body
    await writeRegister(register, data, address)
    res.status(204).send()
  }
)

export default router
