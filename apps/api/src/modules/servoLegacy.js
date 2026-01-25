import { sleep, throttler } from './utils.js'
import config from '@/config.json' with { type: 'json' }
import { setChannels, relax } from './servo.js'

// Legacy constants (kept to preserve prior behavior)
const degPerPathSegment = 2

/** @type {Array<ServoName>} */
// @ts-ignore
const servoNames = Object.keys(config.servos)

/**
 * @returns {ServoPosition}
 */
const getHomePosition = () => Object.entries(config.servos).reduce(
  /**@param {*} acc  */
  (acc, [servoName, { home }]) => {
    return {
      ...acc,
      [servoName]: home
    }
  },
  {}
)

// NOTE: This module keeps its own notion of "current position".
// It is intended for reference/testing; the main motion code uses `apps/api/src/modules/servo.js`.
let currentPosition = getHomePosition()

/**
 * @param {number} angle Angle to interpolate pulseWidth for
 * @param {ServoCalPoint} begin Begin of the interpolation segment
 * @param {ServoCalPoint} end End of the interpolation segment
 * @returns {number}
 */
const interp = (angle, begin, end) => {
  const [a0, u0] = begin
  const [a1, u1] = end
  if (a1 === a0) throw new Error('Duplicate angleDeg in sortedPoints')
  const t = (angle - a0) / (a1 - a0)
  return Math.round(u0 + t * (u1 - u0))
}

/**
 * Legacy angle->pulse mapping used by the old planner.
 * It mirrors the logic in `servo.js` so the legacy mover stays runnable.
 *
 * @param {number} angleDeg
 * @param {{
 *   sortedPoints: Array<ServoCalPoint>
 *   correction: ServoCorrection
 *   clamp?: boolean
 * }} options
 */
const angleDegToPulseUsRaw = (angleDeg, { sortedPoints, correction, clamp = true }) => {
  if (!Array.isArray(sortedPoints) || sortedPoints.length < 2) {
    throw new Error('sortedPoints must have at least 2 [angleDeg, pulseUs] points')
  }
  angleDeg = (angleDeg - correction.offset) / correction.gain
  const n = sortedPoints.length
  if (angleDeg <= sortedPoints[0][0]) {
    return clamp ? sortedPoints[0][1] : interp(angleDeg, sortedPoints[0], sortedPoints[1])
  }
  if (angleDeg >= sortedPoints[n - 1][0]) {
    return clamp ? sortedPoints[n - 1][1] : interp(angleDeg, sortedPoints[n - 2], sortedPoints[n - 1])
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sortedPoints[mid][0] <= angleDeg) lo = mid
    else hi = mid
  }
  return interp(angleDeg, sortedPoints[lo], sortedPoints[lo + 1])
}

const angleDegToPulseUsFactory = ({ clamp = true } = {}) => {
  const closure = Object.entries(config.servos).reduce(
    (acc, [servoName, { calPoints, correction }]) => {
      const sortedPoints = calPoints.slice().sort((a, b) => a[0] - b[0])
      acc[servoName] = { sortedPoints, correction }
      return acc
    },
    {}
  )
  /**
   * @param {{ angleDeg: number, servoName: ServoName }} args
   */
  return ({ angleDeg, servoName }) => angleDegToPulseUsRaw(angleDeg, { ...closure[servoName], clamp })
}

const angleDegToPulseUs = angleDegToPulseUsFactory({ clamp: false })

/**
 * Legacy fixed-step planner (deg-per-segment).
 *
 * @param {ServoPosition} from
 * @param {ServoPosition} to
 * @param {boolean} includeTo
 */
const pathPlannerLegacy = (from, to, includeTo = true) => {
  const longestPathDeg = servoNames.reduce(
    (acc, servoName) => {
      const candidate = Math.abs(to[servoName] - from[servoName])
      return candidate > acc ? candidate : acc
    },
    0
  )
  const extraPoints = longestPathDeg % degPerPathSegment === 0 ? 0 : 1
  const numPoints = Math.floor(longestPathDeg / degPerPathSegment) + 1 + extraPoints

  const deltas = servoNames.reduce(
    (acc, servoName) => {
      acc[servoName] = (to[servoName] - from[servoName]) / (numPoints - 1)
      return acc
    },
    {}
  )

  /** @type {Array<ServoPosition>} */
  const points = Array(numPoints).fill().map(
    (_, idx) => {
      if (!idx) return from
      return servoNames.reduce(
        /**@param {*} acc  */
        (acc, servoName) => {
          acc[servoName] = from[servoName] + idx * deltas[servoName]
          return acc
        },
        {}
      )
    }
  )

  return includeTo ? points : points.slice(0, -1)
}

/**
 * Legacy fixed-step mover.
 *
 * @param {ServoPosition} toPosition
 * @param {Array<ServoPosition>} [via]
 * @param {{relax?: boolean}} [options]
 */
const toPointLegacy = async (toPosition, via = [], options = { relax: true }) => {
  const { points } = [...via, toPosition].reduce(
    (acc, next, idx, arr) => {
      const segmentPoints = pathPlannerLegacy(acc.last, next, idx === arr.length - 1)
      acc.points.push(...segmentPoints)
      acc.last = next
      return acc
    },
    {
      last: currentPosition,
      points: []
    }
  )

  await throttler({
    array: points,
    bulkSize: 1,
    handler: async (point) => {
      const setChannelsData = Object.entries(point).map(
        /** @param {*} arg*/
        ([servoName, angleDeg]) => {
          return {
            channel: config.servos[servoName].channel,
            pulseWidthUs: angleDegToPulseUs({ angleDeg, servoName })
          }
        }
      )
      await setChannels(setChannelsData)
      await sleep(20)
      currentPosition = point
    }
  })

  if (options?.relax) {
    await relax()
  }
}

export {
  pathPlannerLegacy,
  toPointLegacy,
}

