const stepsPerRevolution = 200
const baseStepUs = 4096
const profile = [
  1.000, 0.992, 0.968, 0.931,
  0.883, 0.826, 0.763, 0.697,
  0.633, 0.571, 0.514, 0.466,
  0.429, 0.402, 0.382, 0.250
]
const stepsPerSegment = 2

const planner = (degrees, factor) => {
  const totalSteps = Math.round(degrees * stepsPerRevolution * factor / 360)
  const midSegmentSize = totalSteps - profile.length * stepsPerSegment * 2
  const profileCutPoint = midSegmentSize >= 0
    ? profile.length
    : Math.round(totalSteps / 2 / stepsPerSegment)
  const start = profile.slice(0, profileCutPoint).map(
    g => ({
      steps: stepsPerSegment,
      periodUs: Math.round(baseStepUs * g / factor)
    })
  )
  const end = start.slice().reverse()
  const middle = midSegmentSize > 0
    ? [{
      steps: midSegmentSize,
      periodUs: end[0].periodUs
    }]
    : []
  console.log({ start, middle, end })
  return [...start, ...middle, ...end]
}

planner(360, 2)