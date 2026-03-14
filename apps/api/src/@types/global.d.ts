import config from '@/config.json' with {type: 'json'}

declare global {
  type SetChannel = {
    channel: number
    pulseWidthUs: number
  }
  type KinematicsInput = {
    q0: number
    q1: number
    q2: number
    q3: number
  }
  type KinematicsOutput = {
    x: number
    y: number
    z: number
  }
  type Raw3D = Array<number>
  // --
  type ServoCalPoint = [number, number]
  type ServoName = keyof typeof config['servos']
  type ServoFitting = {
    scale: number
    offset: number
  }
  type ServoData = {
    [name in ServoName]: {
      channel: number
      home: number
      init: number
      calPoints: Array<ServoCalPoint>
      fitting: ServoFitting
    }
  }
  type ServoPosition = {
    [name in ServoName]: number | null
  }
  // --
  type GeomName = keyof typeof config['geom']
  type GeomData = {
    [name in GeomName]: number
  }
  type Fitting = {
    roll: number
    pitch: number
    yaw: number
    t: Array<number>
  }
  type Board = {
    originOffset: [number, number, number],
    cellSize: number
    gripperChannel: number
    open: number
    close: number
    basket: KinematicsOutput
  }
  type Figures = {
    [f in keyof typeof config['figures']]: {
      height: number
      short: string
    }
  }
  type Pca9685Config = {
    address: number
    freq: number
    dtMs: number
  }
  type Mcp23017Config = {
    addresse: number,
    target: 'r' | 'c',
    offset: 0 | 16
  }
  type GpioConfig = {
    intPin?: number
  }
  type Digitizer = {
    elevationMm: number,
    mcp23017: Array<Mcp23017Config>
  }
  type Drivers = {
    pca9685: Pca9685Config
    gpio: GpioConfig
    digitizer: Digitizer
  }
  type Options = {
    debug: boolean
  }
  type Config = {
    units: {
      pulse: 'us'
      angle: 'deg'
      length: 'mm'
    }
    options: Options
    servos: ServoData
    geom: GeomData
    fitting: Fitting
    board: Board
    figures: Figures
    drivers: Drivers
  }
}

export { };