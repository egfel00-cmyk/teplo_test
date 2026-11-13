#!/usr/bin/env python3
"""Линтер дизайна «Лічильників» (83-я сессия; правила — skills/ui-unslop/SKILL.md, по мотивам unslop © Damir Sokolovsky, CC BY 4.0).

python3 tests/design_lint.py  → 0, если чисто; иначе список нарушений и код 1.
Проверяет web/src/styles.css и тексты web/src/i18n.js. Исключения — «материалы» табло и живые состояния (списки ниже).
"""
import re, sys, os, json, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(ROOT, 'web/src/styles.css'), encoding='utf8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
bad = []

# правила без вложенности: селектор { тело }
rules = re.findall(r'([^{}]+)\{([^{}]*)\}', css)

# табло и макеты приборов — «материал» (ролики, ЖК, жёлтая панель газа; 89-я — лицьова панель приладу на лендингу: lp-plate, lp-screw): там градиенты, мелкий текст и трекинг — часть предмета
MATERIAL = re.compile(r'\.(lcd|elcd|el-|wd-|wdrum|gdrum|gd-|drum|lpp-|kprev|whero|lp-tile|lp-fig|bc-paper|bc-fold|pv-bar|phd-over|ph-fields|gpv-|lpg-|seg\b|kind-ill|phd-beam|phd-scan|lp-plate|lp-screw|lp-art-w|aph|art-photo)')
# живые состояния: идёт распознавание/загрузка, мигает светодиод счётчика, крутится индикатор занятости
# + lpMarq — стрічка постачальників на лендингу (решение владельца 10.11: «пусть плывут»)
# + lpPh* — лендинг, крок 1: фото табло сканується й перетікає в табло (власник 10.11, 92-а: «красиво показати перехід з фото в показання»)
LIVE_ANIM = re.compile(r'\b(spin|elblink|lcd-swap|phd-shine|phd-pulse|phd-beam|phd-drop|wdRoll|lpMarq|lpPh\w+)\b')   # lcd-swap — табло тепла чергує 2 значення, як справжній екран (125-а)

for sel, body in rules:
    sel = sel.strip().split('\n')[-1]
    mat = bool(MATERIAL.search(sel))
    # 1. жирность: 400/500/600, 700+ — нет
    for m in re.finditer(r'font-weight:\s*(700|800|900|bold)\b|font:\s*(700|800|900)\s', body):
        bad.append(f'жирность 700+: {sel}')
    # 2. капс и широкий трекинг в интерфейсе
    if re.search(r'text-transform:\s*uppercase', body):
        bad.append(f'капс: {sel}')
    # 3. отрицательный трекинг на мелком тексте (< 24px)
    m = re.search(r'letter-spacing:\s*-', body)
    if m and not mat:
        fs = re.search(r'font-size:\s*(\d+(?:\.\d+)?)px', body)
        if fs and float(fs.group(1)) < 24:
            bad.append(f'минус-трекинг на {fs.group(1)}px: {sel}')
    # 4. текст мельче 11px вне табло
    fs = re.search(r'font-size:\s*(\d+(?:\.\d+)?)px', body)
    if fs and float(fs.group(1)) < 11 and not mat:
        bad.append(f'текст {fs.group(1)}px < 11: {sel}')
    # 5. переходы: одна кривая var(--ease), без all и без геометрии (width/height/top/left/margin)
    for t in re.findall(r'transition:\s*([^;]+)', body):
        if t.strip().startswith('none'):
            continue
        if re.search(r'\ball\b', t):
            bad.append(f'transition: all — {sel}')
        if re.search(r'\b(height|top|left|margin|padding)\b', t):
            bad.append(f'анимируется геометрия ({t.strip()}): {sel}')
        if re.search(r'cubic-bezier|\bease(-in|-out|-in-out)?\b(?!\))', re.sub(r'var\(--ease\)', '', t)):
            bad.append(f'своя кривая вместо var(--ease): {sel}')
    # 6. бесконечные анимации — только живые состояния
    for a in re.findall(r'animation:\s*([^;]+)', body):
        if 'infinite' in a and not LIVE_ANIM.search(a):
            bad.append(f'бесконечная анимация ({a.strip()[:40]}): {sel}')
        if re.search(r'cubic-bezier\(\s*[\d.]+\s*,\s*(1\.[1-9]|[2-9])', a):
            bad.append(f'пружина с перелётом: {sel}')
    # 7. переходы между оттенками (hue-to-hue) и цветные свечения — только в материалах табло
    if not mat:
        # маска (mask-image) — прозорість, не колір: 139-а, затухання пройденого на смужці періоду (.prd-g)
        for g in re.findall(r'(?:linear|radial|conic)-gradient\(([^;]*)', re.sub(r'(?:-webkit-)?mask(?:-image)?:[^;]*;?', '', body)):
            cols = re.findall(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)', g)
            if len(set(c.lower() for c in cols)) >= 2 and 'repeating' not in body:
                bad.append(f'градиент цветов: {sel}')
        for sh in re.findall(r'box-shadow:\s*([^;]+)', body):
            for c in re.findall(r'rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)', sh):
                r, g_, b, a = int(c[0]), int(c[1]), int(c[2]), float(c[3])
                if max(r, g_, b) - min(r, g_, b) > 60 and a > .2:
                    bad.append(f'цветное свечение: {sel}')

# 8. тексты: без «!», без эмодзи и «→» в конце кнопок/ссылок
src = open(os.path.join(ROOT, 'web/src/i18n.js'), encoding='utf8').read()
node = "global.window={};require(process.argv[1]);const T=window.TeploI18n.T;console.log(JSON.stringify(T))"
try:
    T = json.loads(subprocess.run(['node', '-e', node, os.path.join(ROOT, 'web/src/i18n.js')], capture_output=True, text=True, check=True).stdout)
except Exception as e:  # без node — пропускаем тексты
    T = {}
emo = re.compile('[\U0001F300-\U0001FAFF☀-⛿✀-➿⭐✨]')
for lang, d in T.items():
    for k, v in d.items():
        v = re.sub(r'<[^>]+>', '', str(v))
        if '!' in v:
            bad.append(f'«!» в тексте {lang}.{k}: {v[:60]}')
        if emo.search(v):
            bad.append(f'эмодзи в тексте {lang}.{k}: {v[:60]}')
        if re.search(r'\s→\s*$', v):
            bad.append(f'«→» в конце {lang}.{k}: {v[:60]}')

if bad:
    print('Нарушения дизайна (skills/ui-unslop/SKILL.md):')
    for b in bad:
        print('  -', b)
    print(f'Итог: {len(bad)}')
    sys.exit(1)
print('design_lint: чисто')
