## Loading data
Paste CSV content from the calibration endpoint into a MATLAB variable:
```
D = [
  ... paste CSV rows here ...
];
```

## XY fitting (affine)
Each row is `[x_target, y_target, x_measured, y_measured]`.
```
out = xy_position_fitting(D)
```
Produces 3 coefficients per axis: `cx = [c0, c1, c2]`, `cy = [c0, c1, c2]`.
Identity: `cx = [0, 1, 0]`, `cy = [0, 0, 1]`.

## Z fitting (affine)
Each row is `[x_target, y_target, z_target, z_measured]` (N×4) or `[x_target, y_target, z_target, x_measured, y_measured, z_measured]` (N×6).
```
out = z_position_fitting(D)
```
Produces 4 coefficients: `cz = [c0, c1, c2, c3]`.
Identity: `cz = [0, 0, 0, 1]`.

Both outputs include a ready-to-use JSON snippet for the corresponding `config.json` block.
