## Loading data
Paste CSV content from the calibration endpoint into a MATLAB variable:
```
D = [
  ... paste CSV rows here ...
];
```

## XY fitting
Each row is `[x_target, y_target, x_measured, y_measured]`.
```
out = xy_position_fitting(D)
```

## Z fitting
Each row is `[x_target, y_target, z_target, z_measured]` (N×4) or `[x_target, y_target, z_target, x_measured, y_measured, z_measured]` (N×6).
```
out = z_position_fitting(D)
```

Both outputs include a ready-to-use JSON snippet for the corresponding `config.json` block.
