#!/bin/bash
# Claude Code Remote Control for Agena — kept alive by pm2
cd /var/www/tiqr
exec /root/.nvm/versions/node/v20.19.6/bin/claude remote-control --name "Agena"
