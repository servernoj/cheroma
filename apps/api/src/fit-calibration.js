#!/usr/bin/env node
/**
 * Read calibration CSV: one row per sample, seven numbers only (no header row):
 *   q0,q1,q2,q3,x,y,z
 * Run xyz fitting; print JSON to stdout only (geometry from config.json).
 *
 * Pipe-friendly: nested `pnpm` echoes script banners to stdout and breaks `jq`.
 * Use pnpm’s logging switch (see `pnpm run --help`: `--loglevel` / `--silent`), e.g.
 *   from repo root: `pnpm run --silent fit-calibration ./meas.csv | jq .`
 * Or call Node directly (no pnpm noise): `node apps/api/src/fit-calibration.js ./meas.csv | jq .`
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { resolve } from 'node:path'
import { fitXyzFromMeasurements } from './modules/xyzFitting.js'

function fail(message) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: message }, null, 0) + '\n'
  )
  process.exit(1)
}

function parseNumericRows(records) {
  /** @type {number[][]} */
  const rows = []
  for (let i = 0; i < records.length; i++) {
    const row = records[i]
    if (!Array.isArray(row) || row.length < 7) {
      continue
    }
    const nums = row.slice(0, 7).map(cell => Number(String(cell).trim()))
    if (nums.some(n => !Number.isFinite(n))) {
      continue
    }
    rows.push(nums)
  }
  return rows
}

/** pnpm may pass a literal `--` as argv[2]; npm usually strips it. */
const argvRest = process.argv.slice(2)
if (argvRest[0] === '--') argvRest.shift()
const csvPathArg = argvRest[0]
if (!csvPathArg) {
  fail('Usage: node src/fit-calibration.js <path-to.csv>')
}

const csvPath = resolve(process.cwd(), csvPathArg)
let text
try {
  text = readFileSync(csvPath, 'utf8')
} catch (e) {
  fail(`Cannot read file: ${csvPath} (${e?.message ?? e})`)
}

let records
try {
  records = parse(text, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  })
} catch (e) {
  fail(`CSV parse error: ${e?.message ?? e}`)
}

const rows = parseNumericRows(records)

if (rows.length < 4) {
  fail(
    `Need at least 4 numeric rows with 7 columns each (q0,q1,q2,q3,x,y,z); no header row; got ${rows.length} valid row(s)`
  )
}

const Qcmd = rows.map(r => r.slice(0, 4))
const Xmeas = rows.map(r => r.slice(4, 7))

try {
  const out = fitXyzFromMeasurements({ Qcmd, Xmeas })
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
} catch (e) {
  fail(e?.message ?? String(e))
}
