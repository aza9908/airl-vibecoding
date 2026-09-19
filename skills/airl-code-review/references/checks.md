# Где искать типовые дыры

Подсказки для поиска, а не список находок. Каждое совпадение надо открыть и
подтвердить попыткой — иначе в отчёт попадёт шум. Команды запускать из корня
проекта. Служебные папки исключены, чтобы не читать чужие библиотеки.

```bash
EX='--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next --exclude-dir=venv --exclude-dir=.venv --exclude-dir=__pycache__'
```

## Сначала запусти всё, что есть

| Стек | Установка | Сборка | Проверка стиля | Тесты |
|------|-----------|--------|----------------|-------|
| Node / TypeScript | `npm ci` (или `pnpm i` / `yarn`) | `npm run build` | `npm run lint` | `npm test` |
| Python | `pip install -r requirements.txt` | — | `ruff check .` | `pytest` |
| Go | `go mod download` | `go build ./...` | `go vet ./...` | `go test ./...` |

Команды нет в `package.json` или `pyproject.toml` — это находка группы 6, не ошибка.

## Размер и гиганты

```bash
# самые большие файлы с кодом — почти всегда точка боли
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.go' -o -name '*.vue' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/venv/*' \
  -exec wc -l {} + | sort -rn | head -15
```

Файл больше 500 строк — посмотреть, что в нём смешано. Больше 1000 — почти
наверняка ⚪️ «мешает», а если в нём и экран, и запросы к базе, и расчёты — 🟡.

## Группа 1. Логика

```bash
# ошибки, которые глотаются
grep -rnE $EX 'catch\s*(\([^)]*\))?\s*\{\s*\}' .
grep -rnE $EX 'except\s*(Exception)?\s*:\s*pass' .

# обещание без ожидания и без обработки отказа — ошибка уйдёт в никуда
grep -rnE $EX '\.then\(' . | grep -v '\.catch'

# деньги дробными числами
grep -rniE $EX '(price|amount|total|sum|cost).*(parseFloat|toFixed|\* ?0\.|/ ?100)' .

# дата без часового пояса
grep -rnE $EX 'new Date\([^)]*\)\.(getDate|getHours|getMonth)|datetime\.now\(\)|utcnow' .
```

Попытка, а не чтение: открыть каждый экран с пустой базой · ввести 0, −1, текст
из 5000 символов, дату 31 числа · нажать кнопку отправки дважды подряд быстро.

## Группа 2. Устройство

```bash
# адреса, лимиты и настройки в коде
grep -rnE $EX 'https?://[a-z0-9.-]+\.(com|kz|io|dev|app)' . | grep -vE 'README|\.md:|test|spec|schema'

# экран лезет в базу напрямую (React/Vue/Next)
grep -rlE $EX 'from ["'"'"'](@supabase|firebase|pg|mysql2|mongoose|prisma)' . | grep -E 'components?/|pages?/|screens?/|views?/'

# одна и та же логика в нескольких местах — по сигнатурам функций
grep -rhoE $EX '(function|const|def)\s+[a-zA-Z_]+' . | sort | uniq -c | sort -rn | awk '$1 > 1' | head
```

Кольцевые импорты: `npx madge --circular src` (Node) — только если `madge` уже
есть или человек согласен его поставить.

Признак дыры: взять любую мелкую правку из `DESIGN.md` («поменять текст кнопки»,
«добавить поле в форму») и посчитать, сколько файлов придётся тронуть. Больше трёх — 🟡.

## Группа 3. Данные

```bash
# есть ли история изменений структуры базы
ls -d migrations supabase/migrations prisma/migrations alembic drizzle 2>/dev/null

# связи и ограничения в схеме
grep -rnE $EX 'REFERENCES|ON DELETE|UNIQUE|NOT NULL|@unique|@relation|ForeignKey|unique=True' . | head -30
```

Нет папки с миграциями и нет схемы в коде — 🟡 «структура базы живёт в голове».

Попытка: удалить запись-родителя (клиента, проект) и посмотреть, что стало с
дочерними · создать две записи с одинаковым «уникальным» полем · открыть отчёт
после этого.

## Группа 4. Надёжность

```bash
# запросы без ограничения по времени
grep -rnE $EX '(fetch|axios|requests\.(get|post)|httpx)\(' . | grep -viE 'timeout|signal'

# ошибка пользователю как есть
grep -rnE $EX '(alert|toast|message)\([^)]*(err|error|e)\.(message|stack)' .
grep -rnE $EX 'console\.(log|error)\(' . | wc -l   # логи есть, но куда они уходят в бою?
```

Попытка: выключить сеть или подставить неверный адрес внешнего сервиса, открыть
главный экран · отправить форму и сразу обновить страницу — появился ли дубль.

## Группа 5. Рост

```bash
# запрос внутри цикла — «сто записей, сто запросов»
grep -rnE -B3 $EX 'await .*(find|select|get|fetch|query)' . | grep -E 'for \(|for .* in |\.map\(|\.forEach\(' 

# списки без страниц
grep -rnE $EX '\.(select|find|findMany|get)\(' . | grep -viE 'limit|range|take|paginate|page'
grep -rnE $EX 'SELECT \* FROM' . | grep -viE 'LIMIT'
```

Попытка: скриптом создать 1000 записей и открыть список с засечкой времени.
Дольше двух секунд — 🟡, дольше пяти или падает — 🔴.

Предел тарифа: посмотреть в `ARCHITECTURE.md` лимиты бесплатного уровня и прикинуть
при текущем темпе, через сколько месяцев упрётся.

## Группа 6. Сопровождаемость

```bash
# тесты вообще есть
find . -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*.py' -o -name '*_test.go' \) -not -path '*/node_modules/*' | wc -l

# версии не закреплены
grep -nE '"\^|"~|"\*"|latest' package.json 2>/dev/null
grep -vE '==|^#|^$' requirements.txt 2>/dev/null

# зависимости с известными проблемами — только сигнал
npm audit --omit=dev 2>/dev/null | tail -5
pip-audit 2>/dev/null | tail -5

# долги в коде
grep -rnE $EX 'TODO|FIXME|HACK|XXX' . | wc -l
git log -1 --format=%cd -- $(grep -rlE $EX 'TODO|FIXME' . | head -1) 2>/dev/null   # возраст самого старого

# инструкция запуска не врёт
grep -nE 'npm (run )?[a-z]+|pnpm|yarn|python|pytest|make' README.md 2>/dev/null
```

Каждую команду из README реально запустить. Врёт — 🟡: новый человек потеряет
полдня на первом же шаге.

## Что не искать здесь

Ключи, пароли, права доступа, проверка вводимых данных на сервере, потолки
расходов — это `/airl-security`. Попалось по пути — одна строка в отчёте со ссылкой,
без раскрытия значения и без собственной проверки.
