#!/bin/zsh
cd -- "${0:A:h}" || exit 1
python3 scripts/sync-github.py
result=$?
printf '\n按回车关闭窗口。'
read -r
exit "$result"
