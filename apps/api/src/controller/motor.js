import express from 'express'
import * as tools from '@/tools/index.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'

const router = express.Router()

router.get('/config',
  async (req, res) => {
    const config = await tools.motor.getConfig()
    res.json(config)
  }
)

router.post('/config',
  validator({
    body: z.object({
      factor: z.number().refine(x => [1, 2, 4, 8, 16, 32, 64, 128].includes(x), {
        message: 'Must be a power of 2, ranged from 1 to 128 inclusive'
      })
    })
  }),
  async (req, res) => {
    const { factor } = res.locals.parsed.body
    await tools.motor.config(factor)
    res.sendStatus(200)
  }
)

router.post(
  '/profile',
  validator({
    body: z.object({
      repeat: z.number().positive().int().default(1),
      profile: z.array(
        z.object({
          degrees: z.number().int(),
          delay: z.number().nonnegative().default(0),
        })
      )
    })
  }),
  async (req, res) => {
    const { profile, repeat } = res.locals.parsed.body
    await tools.motor.runProfile(profile, repeat)
    res.sendStatus(200)
  }
)

router.post(
  '/free',
  validator({
    body: z.object({
      dir: z.number().int().default(-1)
    })
  }),
  async (req, res) => {
    const { dir } = res.locals.parsed.body
    await tools.motor.freeRun(dir)
    res.sendStatus(200)
  }
)

router.post(
  '/stop',
  async (req, res) => {
    await tools.motor.stop()
    res.sendStatus(200)
  }
)
router.post(
  '/hold',
  async (req, res) => {
    await tools.motor.hold()
    res.sendStatus(200)
  }
)
router.post(
  '/release',
  async (req, res) => {
    await tools.motor.release()
    res.sendStatus(200)
  }
)




export default router