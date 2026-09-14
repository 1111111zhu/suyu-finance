#!/bin/zsh
salary_project="$(cd -- "$(dirname -- "$0")" && pwd)"
exec "$salary_project/启动薪资测算系统.command"
