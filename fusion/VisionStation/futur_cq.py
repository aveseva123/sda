# -*- coding: utf-8 -*-
"""«Футуристичный» внешний вид: скульптурная оболочка корпуса лофтом скруглённых сечений,
световая линия по периметру, капот-капсула с овальным окном и маяком, дисплей на изогнутой консоли,
пульт-под. Вызывается после modern_cq.modernize и заменяет плоские панели. Только CadQuery."""
import cadquery as cq
import cq_helpers as H
from parts_cq import add, drop, box, cyl, V

loc = lambda x, y, z: cq.Location(V(x, y, z))


def rr(w, h, r):
    return cq.Sketch().rect(w, h).vertices().fillet(r)


def loft(secs):
    """secs: [(x, y, z, w, h, r), …] — скруглённые прямоугольники по высоте."""
    return cq.Workplane('XY').placeSketch(*[rr(w, h, r).moved(loc(x, y, z)) for (x, y, z, w, h, r) in secs]).loft(ruled=False).val()


def futurize(P, L):
    zt = L['z_plate_top']
    cx = P['frame_cx']
    # ---------- убрать плоскую облицовку ----------
    for pat in ('Корпус — ', 'Петля дверцы корпуса', 'Замок дверцы корпуса', 'Ручка передней дверцы', 'Цоколь', 'Обрамление столешницы',
                'Столешница', 'Лючок кабелей', 'Профиль алюминиевый 20×20 станочный', 'Профиль 20×20', '[3D] Угловая заглушка',
                'Окно дверцы капота', 'Табличка', 'Светодиодная полоса статуса', 'Световая колонна', 'Кабель световой колонны',
                'Консоль кнопочного поста', 'Стенка капота', 'Крыша капота', 'Торец капота', 'Дверца капота', 'Петля дверцы капота',
                'Ручка дверцы капота', 'Магнитная защёлка', 'Винт M4×12 угла капота', 'Винт M4×12 кронштейна камеры',
                'Стойка дисплея', '[3D] Кронштейн дисплея', 'Болт M6×20 кронштейна дисплея', '[3D] Кронштейн камеры к крыше'):
        drop(pat)

    body = 'Корпус станции'
    # ---------- оболочка корпуса: сужается к полу, большие радиусы, скруглённая верхняя кромка ----------
    outer = loft([(cx, 0, 60, 1260, 480, 50), (cx, 0, 300, 1320, 530, 60), (cx, 0, zt - 10, 1340, 560, 70)])
    outer = cq.Workplane('XY').add(outer).edges('>Z').fillet(25).val()
    inner = loft([(cx, 0, 55, 1256, 476, 48), (cx, 0, 300, 1316, 526, 58), (cx, 0, zt + 20, 1336, 556, 68)])
    skin = outer.cut(inner)
    band_z = 500
    band_box = box(-900, -900, band_z - 2, 1400, 900, band_z + 2)
    band = skin.intersect(band_box)
    skin = skin.cut(band_box)
    # задняя дверца отсека электрики: кусок оболочки, открыт на 100° вокруг кромки x = 720
    reg = box(280, 200, 130, 720, 400, 610)
    door = skin.intersect(reg)
    skin = skin.cut(box(278, 200, 128, 722, 400, 612))
    door = door.rotate(V(720, 274, 0), V(720, 274, 1), -100)
    # передняя сервисная дверца: кусок оболочки, закрыта, с утопленной ручкой
    regf = box(0, -400, 180, 500, -200, 600)
    fdoor = skin.intersect(regf)
    skin = skin.cut(box(-1.5, -400, 178.5, 501.5, -200, 601.5))
    fdoor = fdoor.cut(box(420, -400, 380, 480, -262, 400))
    add(body, 'Оболочка корпуса — сталь 1,5 мм, порошковая окраска белый перламутр (цельная, лофт)', skin)
    add(body, 'Световая линия статуса по периметру — молочный акрил, LED RGB внутри', band)
    add(body, 'Дверца отсека электрики — сегмент оболочки, открыта на 100°', door)
    add(body, 'Сервисная дверца передняя — сегмент оболочки с утопленной ручкой (закрыта)', fdoor)
    for z in (190, 550):
        add(body, 'Скрытая петля дверцы отсека электрики', cyl('z', (720, 272), 5, z - 25, z + 25))
    add(body, 'Замок дверцы отсека (четверть-оборот)', cyl('y', (0, 370), 7, 0, 10).translate(V(300, 262, 0)).rotate(V(720, 274, 0), V(720, 274, 1), -100))
    # столешница: скруглённая, с небольшим свесом, тёмный антрацит под нержавейку сверху
    deck = cq.Workplane('XY').placeSketch(rr(1352, 572, 74).moved(loc(cx, 0, zt))).extrude(3).val()
    deck = deck.cut(box(478, 218, zt - 1, 542, 248, zt + 4))
    add(body, 'Столешница — нержавейка 3 мм шлифованная, скруглённая, лючок кабелей', deck)
    add(body, 'Лючок кабелей — рамка', box(474, 214, zt + 3, 546, 252, zt + 6).cut(box(478, 218, zt + 2, 542, 248, zt + 7)))
    for part in H.PARTS:
        if part['name'].startswith('Плита стенда') and 'лючок' not in part['name']:
            part['shape'] = part['shape'].cut(box(478, 218, zt - 10, 542, 248, zt + 3))
            part['name'] += ', лючок кабелей'
    # нижняя кромка: тёмная юбка, скрывающая колёса
    skirt_o = loft([(cx, 0, 20, 1200, 430, 45), (cx, 0, 62, 1256, 476, 48)])
    skirt_i = loft([(cx, 0, 18, 1196, 426, 43), (cx, 0, 64, 1252, 472, 46)])
    add(body, 'Юбка корпуса — антрацит RAL 7016, закрывает колёса', skirt_o.cut(skirt_i))

    # ---------- капот-капсула ----------
    hood = 'Капот камеры и подсветка'
    xc = (L['x_hood0'] + L['x_hood1']) / 2.0
    zb_h = L['z_belt_top'] - 60
    cap_o = loft([(xc, 0, zb_h, 300, 360, 60), (xc, 0, 1120, 330, 390, 90), (xc, 0, 1330, 230, 270, 100), (xc, 0, 1380, 90, 100, 44)])
    cap_i = loft([(xc, 0, zb_h - 7, 294, 354, 57), (xc, 0, 1120, 324, 384, 87), (xc, 0, 1325, 224, 264, 97), (xc, 0, 1372, 84, 94, 41)])
    cap = cap_o.cut(cap_i)
    win = cq.Workplane('XZ', origin=(xc, -300, 1140)).ellipse(95, 70).extrude(-160).val()
    glass = cap.intersect(win)
    cap = cap.cut(win)
    for x in (L['x_hood0'] - 25, L['x_hood1'] - 5):                      # проходы ленты в торцах
        cap = cap.cut(box(x, -90, 945, x + 40, 90, 1040))
    ring_box = box(0, -900, 1298, 900, 900, 1303)
    ring = cap.intersect(ring_box)
    cap = cap.cut(ring_box)
    add(hood, 'Капот-капсула — композит 3 мм белый, лофт, овальное окно (откидывается вверх на газлифтах)', cap)
    add(hood, 'Окно капота — оргстекло 3 мм тонированное', glass)
    add(hood, 'Световое кольцо статуса капота — акрил, LED RGB', ring)
    beacon = cq.Solid.makeSphere(30, V(xc, 0, 1380)).cut(box(xc - 40, -40, 1340, xc + 40, 40, 1380))
    add(hood, 'Маяк на капоте — купол Ø60, LED красный/зелёный', beacon)
    add(hood, '[3D] Кронштейн камеры к куполу капота', box(xc - 35, -35, L['z_cam'] + 30, xc + 35, 35, 1368))
    for s in (-1, 1):
        add(hood, 'Газлифт окна капота 60 Н', cyl('z', (xc + s * 120, -150), 4, 1000, 1180))
    add(hood, 'Петля окна капота — ось', cyl('x', (-172, 1215), 3, xc - 95, xc + 95))

    # ---------- дисплей на изогнутой консоли ----------
    disp = 'Дисплей оператора'
    xd, zd = P['display_x'], P['display_z']
    dw, dh, dt = P['display']
    yb = P['frame_cy'] - P['frame_l'] / 2.0 - 30
    pts = [(xc + 100, -178, 1180), (xc + 160, -225, 1205), (xd, -262, 1185), (xd, yb + 14, zd + dh / 2 + 4)]
    path = cq.Workplane('XY').spline(pts, includeCurrent=False)
    p0, p1 = V(*pts[0]), V(*pts[1])
    arm = cq.Workplane(cq.Plane(origin=p0, normal=(p1 - p0).normalized())).circle(14).sweep(path, isFrenet=True).val()
    add(disp, 'Консоль дисплея — изогнутая труба Ø28 алюминий, кабели внутри', arm)
    add(disp, 'Шарнир консоли у капота', cq.Solid.makeSphere(20, V(*pts[0])))
    add(disp, 'Шарнир наклона дисплея', cq.Solid.makeSphere(18, V(xd, yb + 14, zd + dh / 2 + 4)))
    back = cq.Workplane('XY').add(box(xd - dw / 2 + 6, yb, zd + 6, xd + dw / 2 - 6, yb + 12, zd + dh - 6)).edges('|Y').fillet(12).val()
    add(disp, 'Задняя крышка дисплея — ABS, скруглённая', back.cut(box(xd - 64, yb - 1, zd + 26, xd + 64, yb + 10, zd + 94)))

    # ---------- пульт-под ----------
    yfr = P['frame_cy'] - P['frame_l'] / 2.0
    pod = cq.Workplane('XY').add(box(698, yfr - 2, zt + 3, 802, yfr + 58, zt + 112)).edges('|Z').fillet(22).val()
    pod = cq.Workplane('XY').add(pod).edges('>Z').fillet(10).val()
    pod = pod.cut(box(712, yfr - 4, zt - 1, 788, yfr + 40, zt + 102))
    add('Кнопочный пост', 'Пульт-под — ABS антрацит, скруглённый', pod)
    return len(H.PARTS)
