# Шаг 0. Проверка Fusion API и план реализации add-in «FL_Prep»

Дата проверки: 2026-09-15. Кода в этом коммите нет — только результат проверки и план.

## Как проверялось

- `help.autodesk.com` из этой среды недоступен (сетевая политика), поэтому использована
  **официальная копия справочника от Autodesk**: репозиторий
  `AutodeskFusion360/FusionAPIReference` (HTML-справка, C++-заголовки, Python-стабы `adsk/*.py`).
  Снимок «Updated for May 2026 Release», коммит `07814d19` от 2026-06-10.
  Дополнительно — форум Fusion API (через поиск).
- Статусы в таблице:
  - **есть** — задокументировано, без пометок;
  - **preview** — в справке стоит предупреждение «preview, может измениться»;
  - **скрыто** — есть только в C++-заголовках с пометкой `hidden and not officially supported`,
    в Python-стабах и справке отсутствует. Из Python такие члены обычно доступны
    (прецедент: `Application.executeTextCommand` годами работал до появления в справке),
    но гарантий нет — только проверка в рантайме;
  - **нет** — в API отсутствует.

## Таблица «функция → статус»

### Drawing API (`adsk.drawing`)

| Функция | Статус | Откуда / с какой версии | Следствие для add-in |
|---|---|---|---|
| `DrawingManager.get()`, `createDrawingInput(dataFile, mode)`, `createDrawing(input) → DataFile` | **скрыто** | заголовки появились в релизе **April 2026**; в `adsk/drawing.py` их нет | Проверка `hasattr(adsk.drawing, 'DrawingManager')` + try/except. Если недоступно — запуск команды `NewFusionDrawingDocumentCommand` (открывается диалог Fusion) и инструкция в отчёте |
| `CreateDrawingInput.creationMode` | только `AutomaticDrawingCreationMode`; `Manual` — «not currently supported» | заголовок | Через API создаётся только **автоматический чертёж** (листы по компонентам); ручные виды/выноски через API не создать |
| `CreateDrawingInput.baseDocumentType` | только `FromScratch`; `FromTemplate` — «not currently supported» | заголовок | **Шаблон рамки/штампа через API подключить нельзя**. Чертёж создаётся «с нуля», о шаблоне — в отчёт |
| `standard` (ISO/ASME), `units` (mm/inch), `isoSheetSize` (A4…A0), `orientationType`, `sheetCreationType` (FirstLevelOnly / AllLevels) | скрыто | заголовок | ISO + A3 + мм + альбомная — задаются. Уровень листов: только первый уровень или все |
| `AutomationPreferences.globalPreferences`: `omitComponentsWithKeywords` («Bolt,Screw,Nut,Washer» по умолчанию), `isDetectAndOmitFasteners`, `isMainAssemblySheetGenerated`, `isSubAssemblySheetGenerated`, `isAnimationSheetGenerated`, `isComponentSheetGenerated`, `isFoldedModelSheetGenerated`, `isFlatPatternSheetGenerated`, `isAutoDimensionEnabled` | скрыто | заголовок | Фурнитуру можно исключить по ключевым словам; **лист взрыв-схемы строится из раскадровки** (`isAnimationSheetGenerated`); деталировка — `isComponentSheetGenerated` |
| `mainAssemblyPreferences` / `subAssemblyPreferences`: `isoViewSheetPreferences`, `orthogonalViewSheetPreferences` (спецификация вкл/выкл + угол листа), `autoDimensionPreferences`, `drawingViewPreferences` (стиль, касательные рёбра, центр. метки/линии) | скрыто | заголовок | Спецификация на ISO-листе сборки включается |
| `componentPreferences`: `sheetViewPreferences` (front/top/right + iso), `autoDimensionPreferences` (стратегия, базовая точка), `drawingViewPreferences` | скрыто | заголовок | Настройки листов деталировки |
| `Drawing.sheets`, `Drawing.activeSheet`, `Sheet.customTables` | скрыто | заголовок | Не требуется |
| `DrawingDocument.drawing`, `Drawing.exportManager`, `createPDFExportOptions(filename)`, `PDFExportOptions.sheetsToExport / sheetRange / openPDF / useLineWeights`, `execute()` | **есть** | Dec 2020 | Совместимо с вашим пакетным экспортом PDF |
| `Drawing.namedViews` | есть | Sept 2023 | Не требуется |

### Animation API (`adsk.fusion`)

| Функция | Статус | Откуда / с какой версии | Следствие для add-in |
|---|---|---|---|
| `Design.animationManager` → `AnimationManager`: `storyboards`, `activeStoryboard`, `activateAnimationWorkspace()`, `isAnimationWorkspaceActive`, `recordingMode`, `isWatermarkShown` | **preview де-факто**: есть в Python-стабах и заголовках релиза **May 2026** без пометки hidden, но страниц в справке нет | стабы `fusion.py`, заголовки `Fusion/Animation/*` | `hasattr(design, 'animationManager')` + try/except |
| `Storyboards.add(isCleanStoryboard=True)`, `item`, `itemByName`, `count` | то же | стабы | **Вариант B возможен**: пустая чистая раскадровка |
| `Storyboard`: `activate`, `copy(name, target, before)`, `deleteMe`, `moveTo`, `reverse`, `play`, `playheadPosition`, `end`, `isViewRecordingOn`, `isInFullScreenMode` | то же | стабы | Свойства `name` **нет**. Имя «Explode_<код>» задаётся только через `copy(name)` (add → copy с именем → удалить исходную) |
| Действия раскадровки: transform / explode / view actions, auto explode | **нет** | в заголовках нет ни одного класса действий (проверено grep по `explode`/`Action`) | **Вариант A невозможен**. Остаются B (пустая раскадровка + векторы в атрибутах + инструкция для Auto Explode) и C (разнесённая копия) |

### Виды, позиции, габариты

| Функция | Статус | Версия | Следствие |
|---|---|---|---|
| `Design.namedViews.add(camera, name='')`, `itemByName`, `homeNamedView` и др. | **есть** | Sept 2023 | ISO / Спереди / Сверху / Сбоку создаём. Известная ошибка (форум): перспективная камера сохраняется с искажённой позицией → сохранять **ортографическую** камеру |
| `Camera.viewOrientation` + `ViewOrientations` (`FrontViewOrientation`, `TopViewOrientation`, `RightViewOrientation`, `IsoTopRightViewOrientation`, …) | есть | 2014 | Камеру для именованных видов строим по этим ориентациям |
| `Design.snapshots.add()`, `hasPendingSnapshot`, `revertPendingSnapshot` | **есть** | 2014 | Capture Position есть. Признак «позиция изменена, но не зафиксирована» — только на уровне всего дизайна (`hasPendingSnapshot`), не по компоненту |
| `MeasureManager.getOrientedBoundingBox(geometry, lengthVector, widthVector)` | есть | Dec 2017 | **Не минимальный** OBB: направления длины и ширины задаём сами (например, по нормали самой большой плоской грани) |
| `BRepBody.orientedMinimumBoundingBox`, `Occurrence.orientedMinimumBoundingBox`, `Component.orientedMinimumBoundingBox` → `OrientedBoundingBox3D` (`centerPoint`, `length/width/height`, `lengthDirection/widthDirection/heightDirection`) | **есть** | Jan 2024 | Минимальный OBB «из коробки». Основной путь для габаритов, толщины и оси текстуры; запасной — своя чистая функция по вершинам |
| `BRepBody.findThicknessAtFace(face, hitPoint=None) → (ok, thickness_cm)` | **preview** | новое | Толщина панели по грани; проверка наличия, запасной путь — минимальный размер OBB |

### Файлы, документы, структура

| Функция | Статус | Версия | Следствие |
|---|---|---|---|
| `DataFile.copy(targetFolder) → DataFile` | **есть** | Sept 2016 | Копия документа для варианта C |
| `DataFile.copyWithInput(CopyDesignFileInput)` → `DataFileFuture`; `CopyDesignFileInput.targetFolder / isCopyDrawings / isCopyReferencedExternalComponents` | preview | May 2024 | Позволяет не копировать связанные чертежи; асинхронно. Используем при наличии, иначе `copy()` |
| `Document.saveAs(name, folder, description, tag)`, `Document.save(description)` | есть, **но «не поддерживается внутри событий команды»** | 2015 / 2014 | Сохранение копии и создание чертежа выполняются **после завершения команды** (обработчик `commandTerminated` или custom event), не в `execute` |
| `Documents.open(dataFile, visible)` | есть | — | Открыть копию |
| `Occurrence.transform2` (get/set) | есть | Jan 2022 | Сдвиг occurrences в копии |
| `Occurrence.isGrounded` (get/set) | есть | — | В копии снять grounded перед сдвигом |
| `BRepBody.createComponent()` | **есть** | June 2015 | Перенос тела в новый компонент = «Create Components from Bodies» (работает в параметрическом режиме, попадает в таймлайн) |
| `BRepBody.moveToComponent(target)` | есть | June 2015 | Резерв для разделения многотельных |
| `Occurrences.addExistingComponent(component, transform)`, `Occurrence.deleteMe()` | есть | 2014 | Замена дубля на экземпляр: удалить occurrence дубля + добавить экземпляр эталона с тем же `transform2`. Joints удаляемого occurrence теряются → только с подтверждением по каждой группе |
| `Occurrence.replace(newFile, replaceAll)` | есть | — | Только для внешних (DataFile) компонентов; для локальных дублей не подходит |
| `Occurrence.isReferencedComponent`; `Document.documentReferences / allDocumentReferences`; `DocumentReference.isOutOfDate / getLatestVersion()`; `Document.isUpToDate / updateAllReferences()` | есть | 2015 / 2017 | Аудит внешних ссылок |
| `Component.partNumber / description / material`, `Design.materials`, `app.materialLibraries` | есть | — | Шаг 3 |
| `Attributes.add(group, name, value)`, `Design.findAttributes(group, name)`, атрибуты у Occurrence и Component | есть | — | Атрибуты `FL_PREP`, сохранение видимости |
| `Component.isSketchFolderLightBulbOn / isConstructionFolderLightBulbOn / isOriginFolderLightBulbOn / isJointsFolderLightBulbOn / isJointOriginsFolderLightBulbOn / isBodiesFolderLightBulbOn / isCanvasFolderLightBulbOn / isDecalFolderLightBulbOn`; `isLightBulbOn` у Occurrence, BRepBody, Sketch, ConstructionPlane, Joint, JointOrigin | есть | — | Шаг 4 |
| `entityToken` (BRepBody, Occurrence, Component, Sketch, …), `Design.findEntityByToken(token)`, `UserInterface.activeSelections.add(entity)` | есть | Sept 2020 | «Выделить в модели» |
| `Joint.deleteMe`, `RigidGroup.deleteMe`, `AssemblyConstraint.deleteMe`; `Component.joints / asBuiltJoints / rigidGroups / assemblyConstraints` | есть (assembly constraints — preview, API «ещё меняется») | — | Только в копии (вариант C). В исходной модели joints не трогаем |
| `ProgressDialog` (+ `adsk.doEvents()`), `Application.log(msg, level, FileLogType)`, `TextCommandPalette.writeText` | есть | — | Прогресс, лог в файл и в Text Commands |

## Что это значит для пайплайна

- **Шаги 1–5** полностью покрыты задокументированным API. Единственный «мягкий» момент —
  `findThicknessAtFace` (preview); без него толщина берётся из OBB.
- **Шаг 6 (взрыв-схема).** Вариант **A невозможен** — действий раскадровки в API нет.
  Реализуем **B** (если `animationManager` доступен) и **C** (всегда). Раскадровка,
  созданная в B, полезна ещё и для шага 7: автоматический чертёж умеет добавить лист
  взрыв-схемы из раскадровки (`isAnimationSheetGenerated`), но саму раскладку в неё
  придётся сделать вручную (Auto Explode по инструкции из отчёта).
- **Шаг 7 (чертёж).** Через скрытый `DrawingManager` можно получить автоматический чертёж
  (ISO, A3, мм, деталировка по компонентам, спецификация на ISO-листе, исключение
  фурнитуры по ключевым словам). Ограничения: **шаблон не поддерживается**, только
  автоматический режим, документ должен быть сохранён (на вход идёт `DataFile`),
  создание — вне `execute`. Если `DrawingManager` из Python недоступен — запускаем штатную
  команду «Чертёж из дизайна» и выводим в отчёт, что выставить в диалоге.
- **Единицы.** Внутри всё в см (как в API), во всех вводах/выводах/атрибутах — мм.

## План реализации

### Структура (предложение: папка `fusion/FL_Prep/` в этом репозитории)

```
fusion/FL_Prep/
  FL_Prep.manifest          # стандартный манифест add-in
  FL_Prep.py                # run()/stop(): регистрация команды, кнопка на панели Utilities
  commands/
    prep/entry.py           # диалог (галочки шагов, dry-run, параметры), execute, прогресс
    select_by_token/entry.py# «Выделить в модели» по entityToken (из отчёта)
    restore_visibility/entry.py # «Вернуть как было» (шаг 4)
  lib/
    capabilities.py         # рантайм-проба API (hasattr + try/except) → словарь → в отчёт
    traversal.py            # обход occurrences с учётом вложенности; уникальные компоненты
    units.py                # см ↔ мм, округление
    geom_pure.py            # ЧИСТЫЕ функции без adsk: OBB по вершинам, сигнатура детали,
                            # группировка дублей, векторы разнесения, ступенька, ориентация
    audit.py                # шаг 1
    normalize.py            # шаг 2
    props.py                # шаг 3
    visibility.py           # шаг 4
    views.py                # шаг 5
    explode.py              # шаг 6 (B, C)
    drawing.py              # шаг 7
    report.py               # шаг 8: HTML + CSV
    settings.py             # JSON рядом с add-in (fallback — папка пользователя, если папка read-only)
    log.py                  # файл + Text Commands
  tests/                    # unittest для geom_pure и report (запуск обычным python3, без Fusion)
  docs/00_API_CHECK.md      # этот документ
```

### Ключевые решения

1. **Проба API один раз при запуске команды** (`capabilities.probe()`): `adsk.drawing.DrawingManager`,
   `design.animationManager`, `Storyboards.add`, `orientedMinimumBoundingBox`, `findThicknessAtFace`,
   `DataFile.copyWithInput`. Результат печатается в отчёт (раздел «Возможности API»). Шаг, для
   которого API нет, пропускается с записью «пропущено: API недоступен», без падения.
2. **Один компонент — один раз.** Обход `rootComponent.allOccurrences`; ключ — `component.entityToken`;
   геометрия считается по первому occurrence, экземпляры учитываются как количество.
3. **OBB.** Основной путь — `body.orientedMinimumBoundingBox` (Jan 2024). Запасной и тестируемый —
   `geom_pure.obb_from_faces()`: ось толщины = нормаль самой большой плоской грани, в плоскости —
   прямоугольник минимальной площади по проекции вершин (rotating calipers). Для панелей результат
   совпадает; в тестах проверяется на синтетических параллелепипедах с поворотом.
4. **Дубли.** Сигнатура детали: объём, площадь, число граней, отсортированные габариты OBB.
   Допуск: 0.01 мм на габариты, относительный 1e-4 на объём/площадь. Чистая функция
   `group_duplicates(signatures)` → группы. В модель — только отчёт и предложение.
5. **Ориентация (шаг 5).** Сравнение осей OBB в локальной системе компонента: длина ↔ X, толщина ↔ Z.
   Только отчёт.
6. **Взрыв (шаг 6).** `geom_pure.explode_vectors(parts, mode, factor, min_gap_mm, subassembly_level,
   hardware_rule)` → векторы в мм. Режимы radial / by normal (по `heightDirection` OBB, знак от центра
   сборки) / by axis. Детали на одном луче раскладываются ступенькой: проекция габаритов на
   направление, сортировка, накопительное смещение с зазором. Фурнитура — отдельный слой дальше
   или скрыта.
   - **B:** `storyboards.add(True)` → `copy('Explode_<код>')` → удалить исходную; векторы в атрибуты
     `FL_PREP/explode_dx_mm, dy, dz`; в отчёт — пошаговая инструкция для Auto Explode.
   - **C:** `DataFile.copy` (или `copyWithInput` без чертежей) → открыть копию → удалить joints,
     as-built joints, rigid groups, assembly constraints; снять `isGrounded`; `transform2` для
     occurrences (подсборки — как единое целое до заданного уровня); `snapshots.add()`; сохранить
     **после завершения команды**. Исходный документ не изменяется. Save Configuration As не используется.
7. **Чертёж (шаг 7).** Если `DrawingManager` доступен: `createDrawingInput(dataFile, Automatic)`,
   ISO / мм / A3 / альбомная, `sheetCreationType` по уровню подсборок, `omitComponentsWithKeywords` =
   префиксы фурнитуры, `isComponentSheetGenerated = True`, `isAnimationSheetGenerated = True` при
   наличии раскадровки, спецификация на ISO-листе. Результат — новый `DataFile`, имя выставляем по
   схеме экспорта PDF (`DataFile.name`). Требуется сохранённый документ без несохранённых изменений
   (иначе — сообщение). Иначе — запуск `NewFusionDrawingDocumentCommand` + инструкция.
8. **Отчёт (шаг 8).** HTML + CSV в заданную папку, имя `<код>_prep_<дата>.html`. Кнопка «выделить в
   модели»: из внешнего HTML-файла в Fusion не достучаться, поэтому два пути: (а) отчёт открывается
   в палитре Fusion (`ui.palettes.add` + `incomingFromHTML`) — клик по строке выделяет деталь через
   `findEntityByToken`; (б) в сохранённом файле у каждой строки токен + кнопка «копировать», в add-in
   есть команда «Выделить по токену». Уровни: ошибка / предупреждение / инфо; колонки «исправлено
   автоматически» / «осталось».
9. **Undo.** Все изменения модели — в `execute` одной команды (один Ctrl+Z). Исключение по требованию
   API: сохранение копии (6C) и создание чертежа (7) — после завершения команды; исходную модель они
   не меняют.
10. **Настройки** — `FL_Prep/settings.json` (последние значения диалога). **Лог** — файл рядом с
    отчётом + `TextCommandPalette.writeText`.

### Этапы сдачи

1. Этот документ → подтверждение и ответы на вопросы ниже.
2. Каркас add-in + `capabilities` + шаг 1 (аудит, dry-run) + отчёт (шаг 8) + тесты `geom_pure`.
3. Шаги 2–5.
4. Шаг 6: B и C (A — только если в API появятся действия раскадровки).
5. Шаг 7.

После каждого этапа: что сделано, как проверить, известные ограничения.

## Что нужно от вас (места [ВСТАВЬ] и вопросы)

1. Папка add-in в репозитории: `fusion/FL_Prep/` — подходит? (Ваши существующие скрипты в этом
   репозитории отсутствуют; если они лежат в другом месте, скажите где, чтобы не дублировать функции.)
2. Схема Part Number, например `<код проекта>-<вид>-<№ детали>`, и **как распознать номер от вашего
   скрипта нумерации** (группа/имя атрибута или правило вида «partNumber непустой и не равен имени
   компонента»).
3. Справочник материалов: список имён в Fusion (или соответствие «декор → материал Fusion → толщина»).
4. Префиксы помощников (`_`, `tmp_`?) и признак фурнитуры (префикс и/или материал).
5. Шаблон рамки/штампа: API его не принимает. Варианты: создавать чертёж без шаблона и писать об этом
   в отчёт, либо не создавать чертёж автоматически, а только готовить модель. Что выбираем?
6. Схема имён чертежей для вашего экспорта PDF.
7. Папка для отчётов.
8. Группа/имена атрибутов, которые ставят ваши скрипты (edge_banding и др.), чтобы читать и не менять.
9. Версия Fusion на рабочих местах. `DrawingManager` появился в заголовках релиза April 2026,
   `animationManager` — May 2026: на более старых сборках шаги 6B и 7 будут пропускаться.
10. Отчёт «выделить в модели»: палитра внутри Fusion (а), файл + команда по токену (б) или оба?
