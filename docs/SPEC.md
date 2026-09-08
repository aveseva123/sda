# SPEC — контракт модулей приложения «Замер деталей»

Мобильное PWA без бэкенда: камера телефона → OpenCV.js → размеры плоских деталей
в мм → сверка с раскроем DXF → реестр остатков. Всё в браузере, офлайн.

Этот документ — **обязательный контракт** между модулями. Каждый модуль реализуется
в отдельном файле, сигнатуры и формы данных ниже менять нельзя без правки SPEC.

## 0. Общие соглашения

- **Без сборщика.** Чистые ES-модули (`import`/`export`), загружаются браузером
  напрямую. Никаких `require`, TypeScript, JSX, npm-зависимостей в рантайме.
  Единственная внешняя библиотека — `vendor/opencv.js` (OpenCV 4.12, UMD, глобал `cv`).
- Модули в `src/vision`, `src/match`, `src/remnants`, `src/store` (кроме IndexedDB),
  `src/testing` **не трогают DOM** и работают и в браузере, и в Node 22
  (`node --test`). OpenCV передаётся параметром `cv` — не глобалом.
- Единицы: длины в **мм**, углы в **градусах**, пиксели — `px`. В именах полей
  суффиксы `Mm`, `Px`, `Deg` обязательны там, где возможна путаница.
- Пиксельная система координат — как в OpenCV: центр пикселя `(i, j)` имеет
  координаты `(i, j)`; левый верхний край изображения — `(-0.5, -0.5)`.
- Точки — массивы `[x, y]`. Гомография — массив из 9 чисел, row-major
  (`H[0..2]` — первая строка). `H` всегда отображает **мм-плоскость мишени →
  пиксели исходного фото**, если не сказано иное.
- Ошибки: модули бросают `Error` с полем `code` (строка из списка кодов ниже) и
  русским `message`. Пайплайн ошибок не бросает, а возвращает `{ ok: false, error }`.
- Изображения между модулями передаются как `ImageData`-подобный объект
  `{ data: Uint8ClampedArray (RGBA), width, height }` либо как `cv.Mat`.
  Любая функция, принимающая `cv.Mat`, **не удаляет** входной Mat; всё, что
  создала сама, удаляет (`.delete()`), кроме того, что возвращает.
- Язык интерфейса и сообщений — русский. Код и комментарии — по-английски.
- Код ошибок/подсказок качества (строки): `NO_TARGET`, `FEW_MARKERS`, `TILT`,
  `TOO_SMALL`, `BLUR`, `GLARE`, `REPROJ`, `LOW_RES`, `NO_PARTS`, `BAD_INPUT`.

## 1. Мишень — `src/vision/target.js`

```js
export const DEFAULT_TARGET = {
  dictionary: 'DICT_4X4_50',
  ids: [0, 1, 2, 3],          // id0 левый верхний, id1 правый верхний, id2 правый нижний, id3 левый нижний
  markerSideMm: 40,
  spacingXMm: 130,            // расстояние между центрами id0→id1
  spacingYMm: 210,            // расстояние между центрами id0→id3
  printScale: 1.0,            // фактический контрольный отрезок / 100 мм
};
export function markerCentersMm(target) // → [{ id, x, y }] с учётом printScale; id0 = (0,0), ось Y вниз
export function markerCornersMm(target, id) // → [[x,y]×4] в порядке ArUco: TL, TR, BR, BL (в мм)
export function allCorrespondences(target) // → [{ id, cornerIndex, x, y }] — 16 точек
export function targetBoundsMm(target, marginMm = 10) // → { minX, minY, maxX, maxY } внешние края меток + запас
export function targetPolygonMm(target, marginMm = 10) // → [[x,y]×4] прямоугольник зоны исключения
```

## 2. Чистая геометрия — `src/vision/geometry.js` (уже написан, использовать)

```js
applyHomography(H, x, y) → [u, v]
invertHomography(H) → H⁻¹ (9)
composeHomography(A, B) → A·B
normalizeHomography(H) → H / H[8]
fitLineTLS(points) → { point:[x,y], dir:[dx,dy] (unit), normal:[nx,ny], residuals:number[], rms }
fitLineRobust(points, { iters = 3, sigmaK = 2.5, minPoints = 4 }) → { ...fitLineTLS, inliers:number, ok:boolean }
intersectLines(l1, l2) → [x, y] | null            // l = { point, dir }
lineDistance(l, p) → signed distance
polygonArea(pts) → number (abs)
polygonCentroid(pts) → [x, y]
convexHull(pts) → pts (CCW)
minAreaRect(pts) → { center:[x,y], size:{ width, height }, angleDeg, corners:[[x,y]×4] } // rotating calipers; width ≥ height
pointInPolygon(p, poly) → boolean
dist(a, b) → number
estimateFocalFromHomography(H, cx, cy) → number | null    // самокалибровка из H (плоскость → px)
decomposePlaneHomography(H, { f, cx, cy }) → { tiltDeg, normal:[3], cameraHeightMm, R:[9], t:[3] }
transformPoints(H, pts) → pts
```

## 3. Синтетика — `src/testing/synth.js` (уже написан, использовать в тестах и тест-режиме)

```js
export function makeHomography({ widthPx, heightPx, pxPerMm, tiltDeg = 0, rollDeg = 0, yawDeg = 0, centerMm = [65, 105], focalPx = null }) → H (мм → px)
export function renderScene(spec, dictBits) → { data, width, height }  // RGBA ImageData-подобный
// spec = { widthPx, heightPx, H, target, parts:[{ x, y, w, h, angleDeg, gray? }], paper:boolean,
//          background:{ gray:210, gradient:0.15 }, glare:[{ x, y, rx, ry }], shadows:boolean,
//          blurSigma:0, noise:0, supersample:3 }
// Части: x,y — центр в мм в системе мишени; w — длина (по локальной оси X), h — ширина; angleDeg — поворот.
export const DICT_4X4_50 // bits: 50 × 4 × 4 (1 = белая ячейка), из src/data/dict4x4_50.json
```

## 4. Настройки — `src/settings.js`

```js
export const DEFAULT_SETTINGS = {
  target: DEFAULT_TARGET,
  quality: {                // пороги качества кадра
    minMarkers: 2, fullMarkers: 4,
    reprojMaxPx: 1.5, tiltMaxDeg: 35, targetMinFraction: 0.05,
    sharpnessMin: 0.02,     // нормированная дисперсия лапласиана (см. quality.js)
    glareMaxFraction: 0.10, minPxPerMm: 1.0,
  },
  segmentation: { bgMinV: 140, bgMaxS: 70, closeKernelMm: 12, minAreaMm2: 400, minSideMm: 15,
                  borderMarginMm: 3, useOtsu: true },
  raster: { maxPxPerMm: 4, maxPixels: 6e6, maxExtentMm: 3000 },   // 6 MP: ~1.3 s на 12-Мп кадр в Node, точность не страдает (субпиксельное уточнение)
  edgeRefine: { enabled: true, searchMm: 3, stepPx: 2, endTrimFrac: 0.1 },
  match: { toleranceMm: 3, ambiguityMm: 5 },
  thickness: { thicknessMm: 0, shootHeightMm: 0 }, // 0 = высота авто из гомографии
  history: { photoMaxPx: 1600 },
  ui: { vibrate: true },
};
export function mergeSettings(base, patch) → deep merge (без мутации)
```

## 5. Vision

### 5.1 `src/vision/aruco.js`
```js
export function createDetector(cv, { target = DEFAULT_TARGET, subpixel = true } = {})
  → { detect(mat /* CV_8UC1 | CV_8UC3 | CV_8UC4 */) → { markers: [{ id, corners:[[x,y]×4] }], rejectedCount }, dispose() }
export function imageDataToMat(cv, imageData) → cv.Mat (CV_8UC4)
export function toGray(cv, mat) → cv.Mat (CV_8UC1)  // любой вход
```
Детектор — `cv.aruco_ArucoDetector` с `cornerRefinementMethod = CORNER_REFINE_SUBPIX`.
Возвращать только метки с id из `target.ids` (остальные — в `rejectedCount` не считать, просто отбросить).

### 5.2 `src/vision/homography.js`
```js
export function buildCorrespondences(markers, target)
  → { srcMm:[[X,Y]...], dstPx:[[u,v]...], ids:number[] }  // по 4 угла на найденную метку
export function computeHomography(cv, corr, { ransacThreshPx = 2 } = {})
  → { H:number[9], Hinv:number[9], inliers:number, reprojRmsPx, reprojMaxPx, perPointErrPx:number[] }
  // H: мм → px. При < 8 точек (менее 2 меток) бросает Error code 'FEW_MARKERS'.
export function assessGeometry({ H, corr, markers, imageWidth, imageHeight, target })
  → { tiltDeg, focalPx, focalSource:'estimated'|'assumed', cameraHeightMm,
      targetFraction,          // площадь выпуклой оболочки углов найденных меток / площадь кадра
      pxPerMmAtTarget,         // средняя сторона метки в px / markerSideMm
      targetPolygonPx:[[x,y]...] }
```
Наклон: `estimateFocalFromHomography`, при неустойчивости — `f = 0.75·max(w,h)` (`focalSource:'assumed'`).

### 5.3 `src/vision/quality.js`
```js
export function sharpness(cv, grayMat, roi /* {x,y,width,height} | null */) → { laplacianVar, contrast, normalized }
  // normalized = laplacianVar / contrast², contrast = p95 − p5 яркости ROI (robust range); безразмерно
export function glareFraction(cv, rgbaOrGrayMat, { threshold = 250 } = {}) → number 0..1
export const HINTS = { NO_TARGET:'Положите мишень в кадр', FEW_MARKERS:'Видно только часть мишени — точность ниже',
  TILT:'Держите телефон ровнее над столом', TOO_SMALL:'Подойдите ближе', BLUR:'Держите ровнее, кадр смазан',
  GLARE:'Отвернитесь от окна, блики мешают', REPROJ:'Мишень читается плохо — переснимите', LOW_RES:'Слишком далеко — подойдите ближе' }
export function evaluateQuality(metrics, thresholds)
  → { warnings:[{ code, message, severity:'warn'|'fatal', value }], fatal: null | { code, message }, ok:boolean }
  // metrics: { markersFound, reprojMaxPx, tiltDeg, targetFraction, sharpnessNormalized, glareFraction, pxPerMmAtTarget }
  // fatal: markersFound < minMarkers → NO_TARGET(0)/FEW_MARKERS(1); pxPerMm < minPxPerMm → LOW_RES. Остальное — warn.
```

### 5.4 `src/vision/rectify.js`
```js
export function planRaster({ H, imageWidth, imageHeight, target, pxPerMmAtTarget, raster /* settings.raster */ })
  → { pxPerMm, originMm:{ x, y }, width, height, M:number[9] /* px фото → px растра */, Minv,
      mmToRaster(x, y) → [u, v], rasterToMm(u, v) → [x, y], boundsMm:{ minX, minY, maxX, maxY } }
  // Рабочая область: проекция углов кадра на плоскость (через H⁻¹), обрезанная до ±maxExtentMm
  // от мишени; точки за «горизонтом» (w ≤ 0) отбрасываются. pxPerMm = min(pxPerMmAtTarget, maxPxPerMm),
  // затем уменьшается, пока width·height ≤ maxPixels.
export function rectify(cv, srcMat, plan, { interpolation = 'linear' } = {}) → cv.Mat (тип как у src), фон белый
```

### 5.5 `src/vision/segment.js`
```js
export function segmentParts(cv, rasterRgba /* CV_8UC4 */, plan, { params /* settings.segmentation */, exclusionPolygonsMm = [] })
  → { mask: cv.Mat (CV_8UC1, 255 = деталь), contours: [{ pointsRaster:[[x,y]...], areaRaster, bboxRaster:{x,y,width,height} }] }
```
Алгоритм: gray + HSV; фон = `V ≥ bgMinV && S ≤ bgMaxS`; кандидат = не фон; Оцу по gray внутри
«не-фона» (если `useOtsu`) как дополнительный признак «тёмное»; MORPH_CLOSE эллипсом
`closeKernelMm·pxPerMm`; заливка дыр (floodFill от рамки + инверсия); обнуление зоны
исключения (мишень) и полосы `borderMarginMm` у краёв растра; фильтр компонент по
площади `minAreaMm2` и минимальной стороне `minSideMm` (по minAreaRect).
Контуры — `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)`; вернуть отсортированные по площади (убыв.).

### 5.6 `src/vision/measure.js`
```js
export function measureContour(grayRaster /* {data,width,height} CV_8UC1 view */, pointsRaster, plan, { edgeRefine /* settings */ })
  → { lengthMm, widthMm, areaMm2, cornersRaster:[[x,y]×4], cornersMm:[[x,y]×4], polygonMm:[[x,y]...],
      angleDeg, rectangularity /* areaContour/areaRect */, refined:boolean,
      refine:{ residualRmsPx, pointsUsed, sides:[{ n, rms }] } | null }
export function refineRectEdges(gray, cornersRaster, { searchPx, stepPx, endTrimFrac, darkInside = true })
  → { corners:[[x,y]×4], lines:[{point,dir}×4], residualRmsPx, pointsUsed, sides:[...], ok }
export function grayView(cv, grayMat) → { data, width, height }   // без копирования, если возможно
export function sampleBilinear(gray, x, y) → number
```
Уточнение: для каждой стороны minAreaRect — точки с шагом `stepPx`, обрезка `endTrimFrac` с
концов; по нормали наружу ±`searchPx` профиль яркости (билинейно), сглаженный (окно 3),
градиент; позиция максимума градиента нужного знака (внутри тёмное → наружу светлеет)
с параболической интерполяцией; `fitLineRobust`; пересечения соседних прямых → углы.
Если `ok === false` (мало точек/плохой RMS) — вернуть minAreaRect без уточнения, `refined:false`.
`lengthMm = max(средние противоположных сторон)`, `widthMm = min(...)`.

### 5.7 `src/vision/pipeline.js`
```js
export function createPipeline(cv) → { analyze(imageData, settings) → Result, preview(imageData, settings) → Preview, dispose() }
```
**Result** (успех):
```js
{ ok: true,
  image: { width, height },
  target: { markersFound, ids:number[], markers:[{ id, corners:[[x,y]×4] }] },
  homography: number[9], homographyInv: number[9],
  quality: { reprojRmsPx, reprojMaxPx, tiltDeg, focalPx, focalSource, cameraHeightMm, targetFraction,
             pxPerMmAtTarget, sharpness:{...}, glareFraction, warnings:[...], ok },
  raster: { pxPerMm, originMm, width, height, M, boundsMm },
  correction: { thicknessMm, shootHeightMm, factor },   // factor = (H−t)/H, применён к размерам; 1 если t=0
  parts: [{ index, lengthMm, widthMm, areaMm2, cornersMm, cornersPx /* через H */, polygonMm, polygonPx,
            angleDeg, rectangularity, refined, refine }],
  timingsMs: { aruco, homography, rectify, segment, measure, total } }
```
**Result** (отказ): `{ ok:false, error:{ code, message }, quality?, target? }` — при `fatal` из evaluateQuality.
**Preview** (для живых подсказок, вход ≤ 720 px по большей стороне):
```js
{ markersFound, ids, tiltDeg|null, targetFraction|null, sharpnessNormalized, glareFraction, pxPerMmAtTarget|null,
  hints:[{ code, message, severity }], ok:boolean, targetPolygonPx|null }
```
Порядок: aruco → homography → geometry → quality (fatal → return) → rectify (RGBA) → segment →
measure (gray растра) → поправка толщины → mm→px через H. `cornersPx` — для отрисовки поверх фото.

### 5.8 Worker и клиент
`src/vision/worker.js` — **классический** worker (не module): `importScripts('../../vendor/opencv.js')`,
дождаться `cv.Mat`, затем `import('./pipeline.js')`. Протокол сообщений:
- `→ { type:'init' }` / `← { type:'ready', opencvVersion }`
- `→ { type:'analyze', id, image: ImageData | ImageBitmap, settings }` / `← { type:'result', id, result }`
- `→ { type:'preview', id, image: ImageData, settings }` / `← { type:'preview', id, result }`
- `← { type:'error', id, error:{ code, message } }`, `← { type:'progress', id, stage }`
ImageBitmap → ImageData внутри worker через OffscreenCanvas (если нет — клиент конвертирует сам).

`src/vision/client.js`:
```js
export function createVisionClient({ workerUrl = new URL('./worker.js', import.meta.url) } = {})
  → { ready: Promise<{opencvVersion}>, analyze(image, settings, { onProgress }) → Promise<Result>,
      preview(imageData, settings) → Promise<Preview>, busy:boolean, terminate() }
```
`preview` — если предыдущий preview ещё считается, новый запрос заменяет ожидание (drop frames).

## 6. Match

### 6.1 `src/match/dxf.js`
```js
export function parseDxf(text) → { header:{ insUnits:number|null, extMin, extMax }, blocks:{ [name]: Entity[] }, entities: Entity[] }
```
Entity (все с `layer`, `type`):
`LINE {start:{x,y}, end}`, `LWPOLYLINE {closed, vertices:[{x,y,bulge}]}`, `POLYLINE {closed, vertices:[{x,y,bulge}]}`,
`CIRCLE {center, radius}`, `ARC {center, radius, startAngleDeg, endAngleDeg}` (CCW),
`ELLIPSE {center, majorAxis:{x,y}, ratio, startParam, endParam}`, `SPLINE {closed, controlPoints:[{x,y}], fitPoints:[{x,y}], degree}`,
`INSERT {name, position:{x,y}, scale:{x,y}, rotationDeg}`, `TEXT {text, position:{x,y}, height}`, `MTEXT {text, position:{x,y}, height}`.
Парсер терпим к CRLF, пробелам, неизвестным сущностям (пропускать), отсутствующему HEADER.

### 6.2 `src/match/parts.js`
```js
export function extractParts(doc, { units = 'auto', arcSegments = 24, sheetMode = 'auto' } = {})
  → { parts: PlanPart[], sheet: { lengthMm, widthMm } | null, strategy:'blocks'|'loops', unitsUsed:'mm'|'in', warnings:string[] }
// PlanPart = { id:string, lengthMm, widthMm, qty, polygonMm:[[x,y]...] | null, areaMm2, rectangular:boolean, source:'block'|'loop'|'list' }
export function entitiesToPolylines(entities, blocks, opts) → [{ points:[[x,y]...], closed, layer }]
export function buildLoops(polylines, tolMm = 0.05) → [{ points:[[x,y]...] }]   // цепочки открытых сегментов в замкнутые контуры
export function normalizeParts(parts) → parts // объединяет одинаковые id, суммирует qty, length ≥ width
```
Стратегия `blocks`: есть INSERT'ы блоков с замкнутой геометрией → деталь = блок, id = имя блока,
qty = число INSERT, размеры — minAreaRect геометрии блока с учётом scale.
Иначе `loops`: замкнутые контуры в модели; контур, содержащий ≥2 других и самый большой — лист
(`sheet`); детали — контуры на глубине 1 (или 0, если листа нет); внутренние — отверстия (игнор).
Подпись: TEXT/MTEXT, чья точка вставки внутри контура; иначе ближайший в 20 мм; иначе `P-01`, `P-02`…
Единицы: `$INSUNITS` 1 → дюймы (×25.4), 4/0/прочее → мм; `units` переопределяет.

### 6.3 `src/match/csv.js`, `src/match/xlsx.js`
```js
export function parseCsv(text) → string[][]   // авто-разделитель (; , tab), кавычки, BOM
export function rowsToParts(rows) → { parts: PlanPart[], warnings }  // заголовки: id|name|артикул|деталь|наименование, length|длина|l|a, width|ширина|w|b, qty|кол|count|n; десятичная запятая
export async function parseXlsx(arrayBuffer) → string[][]   // первый лист; unzip через DecompressionStream('deflate-raw'); sharedStrings; inline strings; числа
```

### 6.4 `src/match/hungarian.js`
```js
export function hungarian(cost /* number[rows][cols], прямоугольная */) → [[row, col]...]  // min total cost, |result| = min(rows, cols)
```

### 6.5 `src/match/assign.js`
```js
export function partDiscrepancy(m, p) → { discrepancyMm /* max(|dL|,|dW|) в лучшей ориентации */, orientation:'same'|'rotated', dL, dW }
export function matchParts(measured /* [{ lengthMm, widthMm }] */, planParts /* PlanPart[] с qty */, { toleranceMm = 3, ambiguityMm = 5 } = {})
  → { matches:[{ measuredIndex, planId, planIndex, discrepancyMm, orientation, dL, dW }],
      missing:[{ planId, planIndex, lengthMm, widthMm, qtyPlanned, qtyFound, qtyMissing }],
      extra:[{ measuredIndex, lengthMm, widthMm, nearest:{ planId, discrepancyMm } | null }],
      candidates:{ [measuredIndex]: [{ planId, planIndex, discrepancyMm, orientation }] /* top-5 по возрастанию */ },
      ambiguous:[{ measuredIndex, planIds:string[] }] }  // 2 кандидата в пределах toleranceMm и разница между ними < ambiguityMm
```
Матрица стоимости: строки — измеренные, столбцы — плановые с развёрнутым qty; стоимость =
discrepancyMm, если ≤ tolerance, иначе `1e6 + discrepancyMm`. Пары с discrepancy > tolerance
после венгерского — не совпадение (в `extra` и `missing`).

## 7. Store — `src/store/db.js` (IndexedDB, имя `sda-measure`, версия 1)
```js
export async function openDb() → Db
Db: {
  getSettings() → settings (merge с DEFAULT_SETTINGS), saveSettings(patch) → settings,
  listOrders() → Order[] (новые сверху), getOrder(id), putOrder(order) → id, deleteOrder(id),
  putMeasurement(m) → id, listMeasurements({ orderId, mode, limit } = {}) → Measurement[] (без photo blob → поле photo опущено? нет: включать; UI сам решает), getMeasurement(id), deleteMeasurement(id),
  listRemnants({ status } = {}) → Remnant[], getRemnant(id), putRemnant(r) → id, deleteRemnant(id), nextRemnantId() → 'R-001'…,
  exportAll() → Promise<object> (blob → { __blob:true, type, dataUrl }), importAll(obj, { merge = true }) → { orders, measurements, remnants },
  clearAll() }
export function uid() → string
Order = { id, name, number, createdAt:ISO, source:{ type:'dxf'|'csv'|'xlsx'|'manual', fileName }, thicknessMm, parts: PlanPart[], sheet }
Measurement = { id, createdAt, mode:'batch'|'single'|'remnant', orderId|null, photo: Blob|null, photoWidth, photoHeight,
  result: Result (без больших массивов? — полностью, polygonPx можно опустить), overrides:{ [index]: { lengthMm, widthMm, planId } }, match: MatchResult|null, notes }
Remnant = { id:'R-001', createdAt, lengthMm, widthMm, areaMm2, polygonMm, thicknessMm, photo: Blob|null, status:'available'|'used', note, measurementId|null, usedFor|null }
```

## 8. Остатки — `src/remnants/fit.js`
```js
export function fitsInRemnant(remnant, need /* { lengthMm, widthMm } */, { marginMm = 5, resolutionMm = 5, angleStepDeg = 15 } = {})
  → { fits:boolean, method:'bbox'|'raster', placement:{ angleDeg, xMm, yMm, rotated } | null }
export function findFittingRemnants(remnants, need, opts) → [{ remnant, placement, wasteMm2 }] по возрастанию wasteMm2
```
Прямоугольный остаток (нет polygon или rectangular) — проверка габаритов в двух ориентациях.
Иначе растровая проверка: полигон растеризуется с шагом `resolutionMm` для углов 0..180 шаг
`angleStepDeg`; окно `need` (+margin) в обеих ориентациях проверяется по summed-area table.

## 9. Экспорт — `src/export/`
```js
// csv.js
export function compareToCsv({ order, measurement, match }) → string  // UTF-8 BOM, ';', заголовок: Статус;ID;План L;План W;Факт L;Факт W;Расхождение
export function measurementsToCsv(measurement) → string
// json.js
export function measurementToJson(measurement, order) → string (pretty)
// image.js (DOM)
export async function renderOverlay(photo /* ImageBitmap|HTMLImageElement */, result, { labels:{ [index]: string }, statuses:{ [index]: 'ok'|'extra'|'ambiguous' } } = {}) → HTMLCanvasElement
// share.js (DOM)
export async function saveOrShare(blob, fileName) // navigator.share(files) → иначе <a download>
```

## 10. Камера — `src/camera/capture.js` (DOM)
```js
export async function listBackCameras() → [{ deviceId, label }]
export async function startCamera(videoEl, { deviceId = null } = {})
  → { stream, track, capabilities, settings, deviceLabel, isMainCameraGuess,
      capturePhoto() → Promise<ImageBitmap>,       // ImageCapture.takePhoto → иначе applyConstraints(max) + grab
      grabFrame(maxSidePx = 640) → ImageData,       // из <video> через canvas
      stop() }
export function pickMainCamera(cameras) → device  // отбрасывает 'wide','ultra','0.5','tele','front'
export async function bitmapFromFile(file) → ImageBitmap   // { imageOrientation:'from-image' }
```

## 11. UI (DOM) — `src/app.js`, `src/ui/*.js`, `index.html`, `styles.css`
- Экраны: `camera` (режимы: Приёмка партии / Одна деталь / Остаток; выбор заказа из списка; живые
  подсказки; кнопка съёмки ≥ 72 px внизу; кнопка «Из галереи/камеры телефона» через `<input type=file capture>`),
  `result`, `compare`, `orders` (импорт DXF/CSV/XLSX, список), `remnants`, `settings`, `test`, `help`, `target` (печать).
- Тач-цели ≥ 64 px, крупный шрифт (≥ 18 px), контраст, тёмная тема по умолчанию; `navigator.vibrate(60)` при успешном замере.
- Роутер по hash: `#/camera`, `#/result/:id`, `#/compare/:id`, `#/orders`, `#/remnants`, `#/settings`, `#/test`, `#/help`.
- Все строки — русские.

## 12. PWA
- `manifest.webmanifest` (display: standalone, orientation any, иконки 192/512 + maskable, lang ru).
- `sw.js`: precache списка `PRECACHE` (генерируется `tools/gen-sw-manifest.mjs` в `sw-manifest.js`), стратегия
  cache-first для всего своего, network-first для `index.html`, `skipWaiting` + `clients.claim`.
- Никаких внешних URL (шрифты, CDN) — всё локально.

## 13. Тесты
- `node --test tests/` — юнит-тесты чистых модулей и пайплайна на синтетике. OpenCV в Node:
  `tests/helpers/cv.mjs` → `export async function loadCv()`.
- Ключевые проверки: синтетический кадр с мишенью и деталью 297×210 при наклоне 0°/20°/30° →
  ошибка ≤ 0.6 мм; 6 деталей разных размеров → все найдены, ошибка ≤ 1 мм; DXF-фикстуры → детали и qty;
  венгерский алгоритм на известных матрицах; сопоставление с поворотом на 90°; fit остатков.
- `tests/e2e/run.mjs` — Playwright (Chromium из `/opt/pw-browsers/chromium-1194`), запускает
  `tools/serve.mjs`, открывает `#/test`, запускает синтетический тест, проверяет таблицу.

## 11a. Контракт экранов и оболочки (обязателен для всех UI-модулей)

`src/ui/components.js`:
```js
export function h(tag, attrs = {}, ...children) → HTMLElement   // attrs: class, id, on:click → addEventListener, style (объект), dataset, any attribute; children: строки/элементы/массивы/null
export function clear(el)
export function toast(text, kind = 'info' | 'ok' | 'error', ms = 2500)
export function confirmDialog(text, { okText = 'Да', cancelText = 'Отмена' } = {}) → Promise<boolean>
export function sheet({ title, content: HTMLElement, actions:[{ text, kind, onClick }] }) → { close() }   // нижняя шторка
export function fmtMm(v) → '297.0'   // 1 знак после запятой, запятая как разделитель не нужна — точка
export function fmtDate(iso) → '08.09.2026 15:40'
export function bigButton(text, onClick, { kind = 'primary'|'secondary'|'danger', icon } = {}) → HTMLButtonElement (min-height 64px)
```
`src/router.js`:
```js
export function createRouter({ root, screens, ctx }) → { navigate(hash), current, start() }
// screens: { camera: () => import('./ui/camera.js'), ... }  — ленивые импорты
// hash-маршруты: '#/camera', '#/result/:id', '#/compare/:id', '#/orders', '#/orders/:id', '#/remnants', '#/settings', '#/test', '#/help', '#/target'
```
Модуль экрана `src/ui/<name>.js`:
```js
export const title = 'Камера';                       // заголовок в шапке
export async function mount(root, ctx, params) → (() => void) | void   // params: { id } из маршрута; вернуть cleanup
```
`ctx` (создаёт `src/app.js`):
```js
{ db,                          // из openDb()
  settings,                    // текущие настройки (объект), обновляется через saveSettings
  saveSettings(patch) → Promise<settings>,
  vision,                      // createVisionClient()
  navigate(hash), toast, confirmDialog,
  state: { mode:'batch'|'single'|'remnant', currentOrderId:string|null, lastMeasurementId:string|null, lastPhoto: ImageBitmap|null, lastResult: Result|null },
  vibrate(ms) }
```
Оболочка `index.html`: `<header>` с заголовком и кнопкой «назад», `<main id="screen">`, нижняя навигация из 4 кнопок
(Камера `#/camera`, Заказы `#/orders`, Остатки `#/remnants`, Ещё `#/settings`) высотой ≥ 64 px. Тёмная тема, шрифт системный ≥ 18 px.
Все экраны, ещё не реализованные, — заглушка `mount(root){ root.textContent = 'Раздел в разработке' }`.
