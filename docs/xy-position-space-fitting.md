# XY Position-Space Fitting — Design Context

## Hardware Overview

- **4-DOF robotic arm**: 1 yaw (base) + 3 pitch (shoulder, elbow, wrist)
- Hobby servos + 3D printed parts → imprecise positioning
- Wrist enforces tool-pitch constraint: `q3 = gamma - q1 - q2` (gamma=180°), keeping TCP vertical
- **TCP equipment**: electromagnet for grabbing chess pieces; stylus for digitizer calibration
- **Target application**: move chess pieces on a 320×320mm board (8×8, 40mm cells)

## Digitizer Platform

- 32×32 pin array, 160×160mm active area (= one quarter of the chess board)
- Touch registers (row, col) → converted to XY in robot frame via known origin offset
- Origin is measured in 3D arm coordinates; all touches share the same Z as the origin
- XY from digitizer is reliable; Z is NOT (3–15mm suspension travel before interrupt fires)
- Planned: 4 placements (board quarters) × 2 Z-levels = 8 sessions; currently only 1 origin is practical

## Why the Previous FK-Based Fitting Failed

### Approach
`Xmeas ≈ R(roll,pitch,yaw) · FK(a·Qcmd + b) + t` — fit per-servo scale/offset (a,b) + 6-DOF registration (R,t) using `lsqnonlin`.

### Problems identified

1. **XY-only residuals leave Z unconstrained** — registration angles (roll, pitch) and tz are weakly observable. The solver pushes them to bounds or trades them against servo params.

2. **Parameter ambiguity** — registration yaw vs base servo offset are confounded (both rotate XY). Translation tx,ty trade off with pitch-chain offsets. Different (R,t,a,b) combos produce identical XY predictions but wildly different Z behavior.

3. **Gamma constraint mismatch** — the fitter uses `q3 = gamma - q1_corrected - q2_corrected` (actual-side), but during calibration with identity correction the physical arm had `q3 = gamma - q1_commanded - q2_commanded + wrist_error`. The fitter's a,b absorb wrist error into shoulder/elbow corrections, making them non-physical. Switching to command-side gamma made a,b even less constrained (shoulder b jumped to −23°).

4. **Qcmd encodes a specific Z that the fitter ignores** — `Qcmd = IK(x_target, y_target, z_at_touch)` where z_at_touch varies per sample (interrupt timing). The fitter treats these angles as arbitrary, establishing no link between the commanded Z and the measured XY. Different Z → different Qcmd → same measured XY → the fitter cannot uniquely decompose the error.

## New Approach: Position-Space Fitting

Instead of decomposing error into per-joint corrections via FK, model the **XY positioning error as a function of target position** directly.

### Data model
For each calibration sample:
- **Target**: `(x_t, y_t)` — where we commanded the arm to go (known from grid geometry + origin)
- **Measured**: `(x_m, y_m)` — where the arm actually touched (from digitizer)
- **Error**: `(dx, dy) = (x_m - x_t, y_m - y_t)`

### Fitting
Model the error field:
```
dx(x, y) = a0 + a1·x + a2·y       (affine: 6 params)
dy(x, y) = b0 + b1·x + b2·y

dx(x, y) = a0 + a1·x + a2·y + a3·x² + a4·xy + a5·y²   (quadratic: 12 params)
dy(x, y) = b0 + b1·x + b2·y + b3·x² + b4·xy + b5·y²
```

Well-determined: 64 samples × 2 residuals vs 6–12 params. No FK, no registration, no ambiguity.

### Deployment
To reach desired `(x_d, y_d, z)`:
```
IK(x_d - dx(x_d, y_d),  y_d - dy(x_d, y_d),  z)
```
Pre-distort the target XY before feeding into IK. No servo correction layer needed.

### Z generalization
- Calibrate at two digitizer heights → two sets of affine/quadratic coefficients
- Interpolate coefficients for intermediate Z (chess piece heights range 35–75mm)

## Current State of the Codebase

**Branch**: `xy-position-space-fitting` (branched from `dev`)
**Restore tag**: `pre-xy-position-space-fitting` on `dev`

### What was removed
- `config.json`: top-level `fitting` (roll,pitch,yaw,t) + per-servo `fitting` (scale,offset)
- `@types/global.d.ts`: `Fitting` type, `ServoFitting` type, `fitting` fields on `ServoData` and `Config`
- `modules/kinematics.js`: `toModel()` function, `fitting` variable, `Matrix`/`rotationMatrix` imports; `IKK` simplified to `K2S(IK(P))`
- `modules/servo.js`: `angleDegToPulseUs` no longer applies scale/offset — angle goes straight to calPoints; `line()` uses `IKK` instead of `K2S(IK(toModel(...)))`
- `controller/config.js`: `fittingSchema`, `servoFittingSchema`, `fitting` from PATCH schema
- `modules/xyzFitting.js`: deleted (old JS Levenberg-Marquardt fitter)
- `fit-calibration.js`: deleted (CLI entry point for old fitter)
- `package.json`: removed `fit-calibration` script

### What remains unchanged
- `modules/calibration.js` — calibration experiment workflow (descent, touch, record)
- `controller/calibration.js` — POST endpoint returning CSV
- `modules/arm.js`, `controller/arm.js` — arm motion (use IKK, which now passes through directly)
- `matlab/xy_fitting.m` — Matlab XY fitter (kept for reference, not used going forward)
- `matlab/xyz_fitting.m` — Matlab XYZ fitter (kept for reference)

## TODO — Next Steps

1. **Update calibration CSV format**: include `x_target, y_target` (known from grid) alongside `x_measured, y_measured` (from digitizer). Qcmd columns may become optional or removed.

2. **Implement position-space fitter** (JS module): least-squares fit of affine or polynomial error model from (target, measured) pairs.

3. **Add XY correction to config**: new config section for the polynomial coefficients (replaces old fitting block).

4. **Integrate correction into IKK** (or a new wrapper): apply pre-distortion before IK.

5. **Collect fresh calibration data** with identity correction (current state) and validate the new approach.

6. **Multi-Z support**: repeat calibration at elevated digitizer, fit per-Z, implement interpolation.

## Key Files for Context

| File | Role |
|------|------|
| `apps/api/src/modules/kinematics.js` | FK, IK, IKK (now raw) |
| `apps/api/src/modules/servo.js` | Angle→pulse, motion planning, `line()` |
| `apps/api/src/modules/calibration.js` | Calibration experiment: grid traversal, descent, digitizer read |
| `apps/api/src/controller/calibration.js` | HTTP endpoint for calibration |
| `apps/api/src/modules/arm.js` | High-level arm motions (descent, lift, search) |
| `apps/api/src/config.json` | Runtime config (geom, servos, board) |
| `apps/api/src/@types/global.d.ts` | TypeScript type definitions |
| `apps/api/take_1.csv` | Sample calibration data (64 rows, 7 cols) |
