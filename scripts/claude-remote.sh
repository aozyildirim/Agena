#!/bin/bash
# Claude Code Remote Control for Agena — kept alive by pm2
cd /var/www/tiqr
exec claude remote-control --name "Agena"
