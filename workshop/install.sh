#!/bin/bash
# Установка навыков AIRL для воскресного интенсива. Запуск: bash workshop/install.sh
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills"

mkdir -p "$DEST"
for skill in airl-start airl-design airl-architecture airl-security; do
  rm -rf "$DEST/$skill"
done
cp -R "$SRC/skills/." "$DEST/"

echo ""
echo "  Готово. Установлены навыки AIRL — версия интенсива:"
echo "    /airl-start          все три шага подряд"
echo "    /airl-design         шаг 1 — как выглядит"
echo "    /airl-architecture   шаг 2 — сборка на Firebase и ссылка web.app"
echo "    /airl-security       шаг 3 — можно ли давать ссылку людям"
echo ""
echo "  Осталось два шага:"
echo "    1. В VS Code: Cmd+Shift+P -> Developer: Reload Window"
echo "    2. В панели Claude наберите /airl-start"
echo ""
