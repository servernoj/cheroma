# Install the service

## Install NVM + Node + PNPM

Follow steps from https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating to install NVM

Then install `Node 22` and `pnpm`
```sh
nvm install 22
nvm alias default 22
npm i -g npm
```

## Install GitHub actions runner

Follow steps in `https://github.com/<username>/<repo>/settings/actions/runners/new`

## Install systemd service

Create file `/etc/systemd/system/cheroma.service` with the following content

```` ini
[Unit]
Description=CheRoMa API Service
After=network.target

[Service]
Type=simple
User=<username>
WorkingDirectory=/home/<username>/cheroma/apps/api
ExecStart=/bin/bash -lc 'source $HOME/.nvm/nvm.sh && node --env-file .env src/index.js'
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
TimeoutStopSec=30s
KillSignal=SIGTERM
SendSIGKILL=yes

[Install]
WantedBy=multi-user.target
````
**Note**: replace `<username>` with your actual username on RasPi

Initialize the unit
```` sh
sudo systemctl daemon-reload
sudo systemctl start cheroma.service
````

Use the following to monitor the logs at realtime
```` sh
journalctl -u cheroma -f
```` 

# Misc
```sh
i2cset -y 1 0x40 0x00 0x10 # sleep
i2cset -y 1 0x40 0xFE 0x79 # frequency 50Hz
i2cset -y 1 0x40 0x00 0x20 # wake up + set auto-inc
i2cset -y 1 0x40 0x01 0x0C # set output + configure PWM reload logic

i2cset -y 1 0x40 0x06 0x00 0x00 0x40 0x01 i # center
```
