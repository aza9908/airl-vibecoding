#!/bin/bash
# Установка навыков AIRL. Запуск: bash install.sh
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills"

mkdir -p "$DEST"
cp -R "$SRC/skills/." "$DEST/"

echo ""
echo "  Готово. Установлены навыки AIRL:"
echo "    /airl-start          все три шага подряд"
echo "    /airl-design         шаг 1 — как выглядит"
echo "    /airl-architecture   шаг 2 — на чём собрать и сборка"
echo "    /airl-security       шаг 3 — можно ли показывать людям"
echo ""
echo "  Осталось два шага:"
echo "    1. В VS Code: Cmd+Shift+P -> Developer: Reload Window"
echo "    2. В панели Claude наберите /airl-start"
echo ""
