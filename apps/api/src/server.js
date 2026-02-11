import express from 'express'
import morgan from 'morgan'
import { queryTypes, fallback, errorHandler } from '@/controller/mw/index.js'
import servo from '@/controller/servo.js'
import arm from '@/controller/arm.js'
import board from '@/controller/board.js'
import { init as driverInit, toHome } from '@/modules/servo.js'

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
  // await toHome({ relax: true, slow: false })
})


