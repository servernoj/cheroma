import express from 'express'
import morgan from 'morgan'
import { queryTypes, fallback, errorHandler } from '@/controller/mw/index.js'
import servo from '@/controller/servo.js'
import arm from '@/controller/arm.js'
import board from '@/controller/board.js'
import { init as driverInit } from '@/modules/driver.js'
import { getPosition, toPoint } from '@/modules/servo.js'
import { closeBus } from '@/modules/utils.js'

export default async () => {
  const app = express()

  app.use(morgan('dev'))
  app.use(express.json(), queryTypes)

  app.get('/health', (req, res) => res.sendStatus(200))
  app.use('/servo', servo)
  app.use('/arm', arm)
  app.use('/board', board)

  app.use(fallback)
  app.use(errorHandler)

  app.listen(3000, async () => {
    console.log('Server started')
    await driverInit()
  })
  const getShutdownHandler = (signal) => {
    const handler = async () => {
      process.off(signal, handler)
      console.warn(`Acting upon '${signal}' signal...`)
      await toPoint(getPosition('init'), [], { relax: true })
      await closeBus()
      process.kill(process.pid, signal)
    }
    return handler
  }
  process.on('SIGINT', getShutdownHandler('SIGINT'))
  process.on('SIGTERM', getShutdownHandler('SIGTERM'))
}

