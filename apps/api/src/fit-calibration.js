import { readFileSync } from 'node:fs'
import { fitXYCorrection } from './modules/xyFitting.js'
import { fitZCorrection } from './modules/zFitting.js'

const mode = process.argv[2]
const csvPath = process.argv[3]

if (!mode || !csvPath || !['xy', 'z'].includes(mode)) {
  console.error('Usage: node fit-calibration.js <xy|z> <path-to-csv>')
  console.error('  xy: CSV with N×4 [xt, yt, xm, ym]')
  console.error('  z:  CSV with N×4 [xt, yt, zt, zm] or N×6 [xt, yt, zt, xm, ym, zm]')
  process.exit(1)
}

const raw = readFileSync(csvPath, 'utf-8')
const data = raw
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split(',').map(Number))

const fmt = v => v.toFixed(6)

if (mode === 'xy') {
  for (const [i, row] of data.entries()) {
    if (row.length !== 4 || row.some(Number.isNaN)) {
      console.error(`Bad row ${i + 1}: expected 4 numeric columns`)
      process.exit(1)
    }
  }
  const result = fitXYCorrection(data)
  console.log('\n--- XY Position-Space Fitting (quadratic) ---')
  console.log(`Samples:     ${result.N}`)
  console.log(`Raw RMSE:    ${result.rmseRaw.toFixed(4)} mm  (before correction)`)
  console.log(`Fit RMSE:    ${result.rmseFit.toFixed(4)} mm  (residual after quadratic model)`)
  console.log(`cx: [${result.cx.map(fmt).join(', ')}]`)
  console.log(`cy: [${result.cy.map(fmt).join(', ')}]`)
  console.log('\nConfig JSON:')
  console.log(JSON.stringify({ xyCorrection: { cx: result.cx, cy: result.cy } }, null, 2))
} else {
  const cols = data[0]?.length
  if (cols !== 4 && cols !== 6) {
    console.error(`Expected 4 or 6 columns, got ${cols}`)
    process.exit(1)
  }
  for (const [i, row] of data.entries()) {
    if (row.length !== cols || row.some(Number.isNaN)) {
      console.error(`Bad row ${i + 1}: expected ${cols} numeric columns`)
      process.exit(1)
    }
  }
  const result = fitZCorrection(data)
  console.log('\n--- Z Position-Space Fitting (quadratic) ---')
  console.log(`Samples:     ${result.N}`)
  console.log(`Raw RMSE:    ${result.rmseRaw.toFixed(4)} mm  (before correction)`)
  console.log(`Fit RMSE:    ${result.rmseFit.toFixed(4)} mm  (residual after quadratic model)`)
  console.log(`cz: [${result.cz.map(fmt).join(', ')}]`)
  console.log('\nConfig JSON:')
  console.log(JSON.stringify({ zCorrection: { cz: result.cz } }, null, 2))
}
