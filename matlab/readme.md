## Loading data
Create local variable `X` by pasting CSV content from the calibration experiment
```
X = [...]
Qcmd = X(:, 1:4);
Xmeas = X(:, 5:7);
```

## First run
```
out1 = xyz_fitting(Qcmd, Xmeas, geom0, 180)
```

## Second run
It uses initialization data from the 1st run, i.e. `out1`
```
out2 = xyz_fitting(Qcmd, Xmeas, geom0, 180, struct('init',out1, 'freeGeom', {{'L2','L3'}}, 'geomRange',30))
```