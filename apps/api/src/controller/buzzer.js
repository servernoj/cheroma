import express from 'express'
import * as tools from '@/tools/index.js'
import { validator } from '@/controller/mw/index.js'
import z from 'zod'
import { buzzer } from '@/tools/index.js'

const supportedNotes = Object.keys(buzzer.notes)
const supportedMelodies = Object.keys(buzzer.melodies)

const router = express.Router()

router.post(
  '/profile',
  validator({
    body: z.object({
      profile: z.array(
        z.object({
          note: z.enum(supportedNotes),
          length: z.number().nonnegative()
        })
      )
    })
  }),
  async (req, res) => {
    const { profile } = res.locals.parsed.body
    await tools.buzzer.runProfile(profile)
    res.sendStatus(200)
  }
)

router.post(
  '/melody/:id',
  validator({
    params: z.object({
      id: z.enum(supportedMelodies)
    })
  }),
  async (req, res) => {
    const { id } = res.locals.parsed.params
    await tools.buzzer.runProfile(buzzer.melodies[id])
    res.sendStatus(200)
  }
)

export default router