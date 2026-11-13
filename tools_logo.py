"""Логотип і іконки peredai.com.ua («Барабан», 127-а сесія; власник обрав варіант 2 з 6 — полотно claude.ai «Логотип peredai.com.ua — варіанти»).

  python3 -I tools_logo.py            → web/icon/* (фавікон, apple-touch, manifest, 192/512) і web/icon/peredai-icons.zip (iOS, Android, веб, Telegram)
  python3 -I tools_logo.py --inline   → друкує SVG маленького знака для logo() у web/src/app.js

Потрібно: pip uharfbuzz fonttools pillow playwright (+ chromium). Шрифт Unbounded (OFL) качається з github.com/google/fonts у /tmp.
Текст — у криві (шрифт у файли не потрапляє). Інші 5 напрямків (скло «П.», аврора, прилад, «й», мінімалізм) — функції нижче, у паку не йдуть."""
import math, os, json
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(os.path.abspath(__file__))
FDIR = '/tmp/peredai-fonts'
FONTS = {'unb': os.path.join(FDIR, 'Unbounded[wght].ttf'), 'man': os.path.join(FDIR, 'Manrope[wght].ttf')}
FURL = {'unb': 'ofl/unbounded/Unbounded%5Bwght%5D.ttf', 'man': 'ofl/manrope/Manrope%5Bwght%5D.ttf'}


def _font(k):
    if not os.path.exists(FONTS[k]):
        import urllib.request
        os.makedirs(FDIR, exist_ok=True)
        urllib.request.urlretrieve('https://raw.githubusercontent.com/google/fonts/main/' + FURL[k], FONTS[k])
    return FONTS[k]
_tt, _hb = {}, {}


def text_path(font, text, wght, size, x=0, y=0, track=0):
    """→ (d, width, (xmin, ymin, xmax, ymax)) — рядок у кривих; y — базова лінія."""
    if font not in _tt:
        _tt[font] = TTFont(_font(font))
        _hb[font] = hb.Face(hb.Blob.from_file_path(_font(font)))
    tt, face = _tt[font], _hb[font]
    f = hb.Font(face)
    f.set_variations({'wght': wght})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(f, buf, {'kern': True, 'liga': True})
    gs = tt.getGlyphSet(location={'wght': wght})
    sc = size / face.upem
    pen, bp = SVGPathPen(gs), BoundsPen(gs)
    cx = 0
    for i, p in zip(buf.glyph_infos, buf.glyph_positions):
        g = tt.getGlyphName(i.codepoint)
        tr = (sc, 0, 0, -sc, x + (cx + p.x_offset) * sc, y - p.y_offset * sc)
        gs[g].draw(TransformPen(pen, tr))
        gs[g].draw(TransformPen(bp, tr))
        cx += p.x_advance + track * face.upem / 1000
    return pen.getCommands(), cx * sc, bp.bounds


def squircle(cx=512, cy=512, r=512, n=5.0, k=160):
    pts = []
    for i in range(k):
        t = 2 * math.pi * i / k
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + r * math.copysign(abs(c) ** (2 / n), c), cy + r * math.copysign(abs(s) ** (2 / n), s)))
    return 'M' + ' L'.join(f'{a:.1f} {b:.1f}' for a, b in pts) + 'Z'


SQ = squircle()

# ── Знак «П.»: літера П як труба з двома відводами (П-подібний компенсатор тепломережі), гаряче → холодне,
#    крапка — як десяткова на табло лічильника й як «передано.» ──
W = 140                      # товщина труби
LX, RX, TOP, BY = 300, 640, 290, 760
RC = 118                     # радіус відводу (по осі)
PIPE = f'M{LX} {BY} V{TOP + RC} A{RC} {RC} 0 0 1 {LX + RC} {TOP} H{RX - RC} A{RC} {RC} 0 0 1 {RX} {TOP + RC} V{BY}'
DOT_R = 64
DOT = (RX + W / 2 + 34 + DOT_R, BY + W / 2 - DOT_R)
BB = (LX - W / 2, TOP - W / 2, DOT[0] + DOT_R, BY + W / 2)        # рамка знака
CENTER = f'translate({512 - (BB[0] + BB[2]) / 2:.1f} {512 - (BB[1] + BB[3]) / 2:.1f})'
HOT_COLD = [(0, '#FF8A1F'), (0.28, '#FF4B3A'), (0.52, '#A35CFF'), (0.76, '#3F7BFF'), (1, '#22B0FF')]


def grad(id_, stops, x1=LX - W / 2, x2=RX + W / 2, y1=0, y2=0, units=True):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    u = ' gradientUnits="userSpaceOnUse"' if units else ''
    return f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"{u}>{s}</linearGradient>'


def pipe_shape(fill, extra='', dot=None):
    """Труба «П» одним кольором/градієнтом; dot — колір крапки (None — без неї)."""
    d = f'<circle cx="{DOT[0]:.1f}" cy="{DOT[1]:.1f}" r="{DOT_R}" fill="{dot}"/>' if dot else ''
    return f'<path d="{PIPE}" fill="none" stroke="{fill}" stroke-width="{W}" stroke-linecap="round" {extra}/>' + d


def pipe_mask(id_):
    return (f'<mask id="{id_}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">'
            + pipe_shape('#fff') + '</mask>')


SPHERE = [(0, '#FFC069'), (.5, '#FF5A2E'), (1, '#D9285F')]


def glass_sphere(p, cx, cy, r, stops=SPHERE, shadow=True):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    sh = (f'<g opacity=".45" filter="url(#{p}sb)"><circle cx="{cx:.1f}" cy="{cy + r * .3:.1f}" r="{r * .92:.1f}" fill="#7A1030"/></g>' if shadow else '')
    return (f'<defs><radialGradient id="{p}sg" cx=".36" cy=".3" r=".78">{s}</radialGradient>'
            f'<filter id="{p}sb" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="{r * .28:.1f}"/></filter>'
            f'<filter id="{p}sb2"><feGaussianBlur stdDeviation="1.3"/></filter></defs>{sh}'
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="url(#{p}sg)"/>'
            f'<path d="M{cx - r * .62:.1f} {cy - r * .2:.1f} A{r * .66:.1f} {r * .66:.1f} 0 0 1 {cx - r * .12:.1f} {cy - r * .64:.1f}" fill="none" stroke="#fff" stroke-width="{r * .13:.1f}" stroke-linecap="round" opacity=".9" filter="url(#{p}sb2)"/>')


def glass_pipe(p, body, glow_op=.45, glow_dy=26, glow_blur=30, body_op=.94, hi_op=.6, mono=False, sphere=SPHERE):
    """«Рідке скло»: кольорова тінь-світіння, тіло, внутрішні блики й затінення, дзеркальний кант, скляна кулька-крапка."""
    o = W / 2 - 16             # дзеркальний кант — по зовнішньому краю лівого коліна
    spec_arc = (f'M{LX - o} {TOP + RC + 90} V{TOP + RC} A{RC + o} {RC + o} 0 0 1 {LX + RC} {TOP - o} H{LX + RC + 70}')
    return f'''<g transform="{CENTER}">
    <defs>{pipe_mask(p+'m')}
      <filter id="{p}b1" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="{glow_blur}"/></filter>
      <filter id="{p}b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
      <filter id="{p}b3"><feGaussianBlur stdDeviation="1.4"/></filter>
    </defs>
    <g opacity="{glow_op}" filter="url(#{p}b1)" transform="translate(0 {glow_dy})">{pipe_shape(body)}</g>
    <g opacity="{body_op}">{pipe_shape(body)}</g>
    <g mask="url(#{p}m)">
      <g filter="url(#{p}b2)">
        <g transform="translate(-20 -24)" opacity="{hi_op}"><path d="{PIPE}" fill="none" stroke="#fff" stroke-width="32" stroke-linecap="round"/></g>
        <g transform="translate(24 28)" opacity="{.22 if not mono else .12}"><path d="{PIPE}" fill="none" stroke="#0B1030" stroke-width="66" stroke-linecap="round"/></g>
      </g>
    </g>
    <path d="{spec_arc}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".9" filter="url(#{p}b3)"/>
    {glass_sphere(p + 'd', DOT[0], DOT[1], DOT_R, sphere)}
    </g>'''


def icon(p, bg, fg, clip=True):
    if not clip:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{bg}{fg}</svg>'
    c = f'<clipPath id="{p}sq"><path d="{SQ}"/></clipPath>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>{c}</defs>'
            f'<g clip-path="url(#{p}sq)">{bg}</g>{fg}</svg>')


# ═════ 1. Рідке скло — «П.» (світла, темна, прозора) ═════
def lg_pipe(p, mode='light'):
    if mode == 'light':
        bg = (f'<defs><linearGradient id="{p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBFCFE"/><stop offset="1" stop-color="#DCE4EF"/></linearGradient>'
              f'<radialGradient id="{p}bh" cx=".25" cy=".12" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>{grad(p+"g", HOT_COLD)}</defs>'
              f'<rect width="1024" height="1024" fill="url(#{p}bg)"/><rect width="1024" height="1024" fill="url(#{p}bh)"/>')
        fg = glass_pipe(p, f'url(#{p}g)')
    elif mode == 'dark':
        bg = (f'<defs><linearGradient id="{p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A2033"/><stop offset="1" stop-color="#07090F"/></linearGradient>{grad(p+"g", HOT_COLD)}</defs>'
              f'<rect width="1024" height="1024" fill="url(#{p}bg)"/>')
        fg = glass_pipe(p, f'url(#{p}g)', glow_op=.75, glow_dy=0, glow_blur=46, hi_op=.5)
    else:  # clear — монохромне скло (iOS «Прозорий»)
        bg = (f'<defs><linearGradient id="{p}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C9D3E0"/><stop offset=".55" stop-color="#9AA8BB"/><stop offset="1" stop-color="#6E7D93"/></linearGradient>'
              f'<linearGradient id="{p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity=".42"/></linearGradient></defs>'
              f'<rect width="1024" height="1024" fill="url(#{p}bg)"/>')
        fg = glass_pipe(p, f'url(#{p}g)', glow_op=.25, glow_dy=20, body_op=1, hi_op=.8, mono=True,
                        sphere=[(0, '#FFFFFF'), (.6, '#E9EEF5'), (1, '#AFBACB')])
    edge = f'<path d="{SQ}" fill="none" stroke="#fff" stroke-opacity="{.55 if mode != "dark" else .12}" stroke-width="5"/>'
    return icon(p, bg, fg + edge)


# ═════ 2. Рідке скло — «Барабан»: вікно лічильника, остання цифра червона й котиться ═════
def lg_drum(p, mode='light', bleed=False):
    dark = mode == 'dark'
    c0, c1 = ('#2C3A63', '#070A14') if dark else ('#3A6BFF', '#0B1F6B')
    bg = (f'<defs><linearGradient id="{p}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c0}"/><stop offset="1" stop-color="{c1}"/></linearGradient>'
          f'<radialGradient id="{p}bh" cx=".22" cy=".08" r=".8"><stop offset="0" stop-color="#fff" stop-opacity="{.08 if dark else .32}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
          f'<rect width="1024" height="1024" fill="url(#{p}bg)"/><rect width="1024" height="1024" fill="url(#{p}bh)"/>')
    cw, ch, gap, n = 158, 262, 18, 4
    x0 = 512 - (n * cw + (n - 1) * gap) / 2
    y0 = 512 - ch / 2
    cells, digits = '', ''
    for i, (dg, red) in enumerate([('0', False), ('4', False), ('2', False), ('7', True)]):
        x = x0 + i * (cw + gap)
        cells += f'<rect x="{x:.1f}" y="{y0:.1f}" width="{cw}" height="{ch}" rx="26" fill="{"#FF3B3B" if red else "#F7F8FC"}"/>'
        ink = '#fff' if red else '#12141C'
        rolls = (('7', -ch * .2), ('8', ch * .8)) if red else ((dg, 0),)
        g = ''
        for d2, dy in rolls:
            dd, dw, (gx0, gy0, gx1, gy1) = text_path('unb', d2, 700, 182, 0, 0)
            tx = x + cw / 2 - (gx0 + gx1) / 2
            ty = y0 + ch / 2 - (gy0 + gy1) / 2 + dy
            g += f'<path d="{dd}" fill="{ink}" transform="translate({tx:.1f} {ty:.1f})"/>'
        digits += f'<g clip-path="url(#{p}c{i})">{g}</g>'
    clips = ''.join(f'<clipPath id="{p}c{i}"><rect x="{x0 + i * (cw + gap):.1f}" y="{y0:.1f}" width="{cw}" height="{ch}" rx="26"/></clipPath>' for i in range(n))
    shade = ''.join(f'<rect x="{x0 + i * (cw + gap):.1f}" y="{y0:.1f}" width="{cw}" height="{ch}" rx="26" fill="url(#{p}cyl)"/>' for i in range(n))
    cap_x, cap_y, cap_w, cap_h = x0 - 40, y0 - 40, n * cw + (n - 1) * gap + 80, ch + 80
    crx = 66
    fg = f'''<defs>{clips}
      <linearGradient id="{p}cyl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".22" stop-color="#000" stop-opacity="0"/>
        <stop offset=".42" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
      <linearGradient id="{p}gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
      <filter id="{p}sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="30"/></filter>
      <filter id="{p}b"><feGaussianBlur stdDeviation="1.5"/></filter>
      <clipPath id="{p}cap"><rect x="{cap_x:.1f}" y="{cap_y:.1f}" width="{cap_w:.1f}" height="{cap_h:.1f}" rx="{crx}"/></clipPath>
    </defs>
    <rect x="{cap_x:.1f}" y="{cap_y + 34:.1f}" width="{cap_w:.1f}" height="{cap_h:.1f}" rx="{crx}" fill="#000831" opacity=".45" filter="url(#{p}sh)"/>
    <rect x="{cap_x:.1f}" y="{cap_y:.1f}" width="{cap_w:.1f}" height="{cap_h:.1f}" rx="{crx}" fill="url(#{p}gl)"/>
    {cells}{digits}{shade}
    <g clip-path="url(#{p}cap)"><path d="M{cap_x:.1f} {cap_y:.1f} H{cap_x + cap_w:.1f} V{y0 + ch * .28:.1f} Q512 {y0 + ch * .05:.1f} {cap_x:.1f} {y0 + ch * .36:.1f}Z" fill="#fff" opacity=".16"/></g>
    <rect x="{cap_x:.1f}" y="{cap_y:.1f}" width="{cap_w:.1f}" height="{cap_h:.1f}" rx="{crx}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="5"/>
    <path d="M{cap_x + 14:.1f} {cap_y + cap_h * .55:.1f} V{cap_y + crx:.1f} A{crx - 14} {crx - 14} 0 0 1 {cap_x + crx:.1f} {cap_y + 14:.1f} H{cap_x + crx + 120:.1f}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".85" filter="url(#{p}b)"/>
    ''' + ('' if bleed else f'<path d="{SQ}" fill="none" stroke="#fff" stroke-opacity="{.12 if dark else .35}" stroke-width="5"/>')
    return icon(p, bg, fg, clip=not bleed)


# ═════ 3. Аврора — 4 ресурси (тепло, вода, світло, газ) + білий «П.» ═════
def aurora(p, mode='light'):
    blobs = [('#FF5A1F', 210, 200, 430), ('#FFC21A', 880, 170, 380), ('#2F7BFF', 860, 900, 470), ('#8B5CF6', 140, 900, 420), ('#FF3D7F', 520, 520, 200)]
    if mode == 'dark':
        blobs = [(c, x, y, r * .78) for c, x, y, r in blobs]
    b = ''.join(f'<circle cx="{x}" cy="{y}" r="{r:.0f}" fill="{c}"/>' for c, x, y, r in blobs)
    base = '#0B0D14' if mode == 'dark' else '#F2EEF8'
    bg = f'''<defs><filter id="{p}bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="130"/></filter>
      <filter id="{p}gr"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter></defs>
      <rect width="1024" height="1024" fill="{base}"/><g filter="url(#{p}bl)" opacity=".95">{b}</g>
      <rect width="1024" height="1024" filter="url(#{p}gr)" opacity=".13"/>'''
    fg = (f'<defs><filter id="{p}sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter></defs>'
          f'<g transform="{CENTER}"><g opacity=".22" filter="url(#{p}sh)" transform="translate(0 22)">{pipe_shape("#1A0B3A", dot="#1A0B3A")}</g>'
          f'{pipe_shape("#fff", dot="#fff")}</g>')
    return icon(p, bg, fg)


# ═════ 4. Прилад — семисегментне «П.» (РК і ВЛІ) ═════
def seg_poly(x1, y1, x2, y2, t, gap=10):
    """Сегмент з гострими кінцями від (x1,y1) до (x2,y2)."""
    h = t / 2
    if y1 == y2:   # горизонтальний
        a, b = x1 + gap, x2 - gap
        return f'M{a} {y1} L{a+h} {y1-h} L{b-h} {y1-h} L{b} {y1} L{b-h} {y1+h} L{a+h} {y1+h}Z'
    a, b = y1 + gap, y2 - gap
    return f'M{x1} {a} L{x1+h} {a+h} L{x1+h} {b-h} L{x1} {b} L{x1-h} {b-h} L{x1-h} {a+h}Z'


def seven(lit, x0=352, y0=272, w=290, h=480, t=72):
    ym = y0 + h / 2
    S = {'a': (x0, y0, x0 + w, y0), 'b': (x0 + w, y0, x0 + w, ym), 'c': (x0 + w, ym, x0 + w, y0 + h),
         'd': (x0, y0 + h, x0 + w, y0 + h), 'e': (x0, ym, x0, y0 + h), 'f': (x0, y0, x0, ym), 'g': (x0, ym, x0 + w, ym)}
    on = ''.join(f'<path d="{seg_poly(*S[k], t)}"/>' for k in S if k in lit)
    off = ''.join(f'<path d="{seg_poly(*S[k], t)}"/>' for k in S if k not in lit)
    return on, off


def device(p, mode='lcd'):
    on, off = seven('abcef')
    dp = '<circle cx="716" cy="752" r="40"/>'
    skew = 'transform="translate(34 0) skewX(-7)"'
    if mode == 'lcd':
        bg = (f'<defs><linearGradient id="{p}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3F6F4"/><stop offset="1" stop-color="#D6DED9"/></linearGradient>'
              f'<linearGradient id="{p}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9D4AE"/><stop offset="1" stop-color="#B3C097"/></linearGradient>'
              f'<filter id="{p}in"><feGaussianBlur stdDeviation="10"/></filter></defs>'
              f'<rect width="1024" height="1024" fill="url(#{p}h)"/>')
        fg = f'''<rect x="168" y="168" width="688" height="688" rx="104" fill="#1E2723"/>
          <rect x="212" y="212" width="600" height="600" rx="66" fill="url(#{p}l)"/>
          <rect x="212" y="212" width="600" height="600" rx="66" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="22" filter="url(#{p}in)"/>
          <g transform="translate(46 10) skewX(-7)" opacity=".12" fill="#1C2618">{on}{dp}</g>
          <g {skew}><g fill="#A4B188">{off}</g><g fill="#1C2618">{on}{dp}</g></g>
          <path d="M244 244 H560" stroke="#fff" stroke-opacity=".35" stroke-width="10" stroke-linecap="round"/>'''
    else:   # ВЛІ — вакуумно-люмінесцентний індикатор, бірюзове сяйво
        bg = (f'<defs><radialGradient id="{p}v" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#0E2A2A"/><stop offset="1" stop-color="#030607"/></radialGradient>'
              f'<filter id="{p}gl" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="22"/></filter>'
              f'<filter id="{p}gl2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>'
              f'<pattern id="{p}mesh" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 7 H14 M7 0 V14" stroke="#9FFFE9" stroke-opacity=".05" stroke-width="2"/></pattern></defs>'
              f'<rect width="1024" height="1024" fill="url(#{p}v)"/><rect width="1024" height="1024" fill="url(#{p}mesh)"/>')
        fg = f'''<g {skew}><g fill="#5CFFD8" opacity=".06">{off}</g>
            <g fill="#2BFFC9" filter="url(#{p}gl)" opacity=".85">{on}{dp}</g>
            <g fill="#8BFFE4" filter="url(#{p}gl2)">{on}{dp}</g>
            <g fill="#E6FFF8">{on}{dp}</g></g>'''
    return icon(p, bg, fg)


# ═════ 5. Шрифтовий — «й» з дужкою гаряче → холодне ═════
BREVE = [(0, '#FF6A1F'), (.5, '#B44DFF'), (1, '#2E86FF')]


def breve(cx, top, w, t, p, color=None):
    """Дужка «й» — ∪, кінці круглі; color — суцільний колір замість градієнта."""
    r = w / 2
    g = '' if color else f'<defs>{grad(p+"br", BREVE, x1=cx-r-t, x2=cx+r+t)}</defs>'
    st = color or f'url(#{p}br)'
    return (g + f'<path d="M{cx-r:.1f} {top:.1f} A{r:.1f} {r*0.82:.1f} 0 0 0 {cx+r:.1f} {top:.1f}" fill="none" stroke="{st}" stroke-width="{t:.1f}" stroke-linecap="round"/>')


def type_icon(p, mode='light'):
    ink, bgc = ('#15161A', '#F4F0E8') if mode == 'light' else ('#F4F0E8', '#121318')
    size = 600
    d, w, (x0, y0, x1, y1) = text_path('unb', 'и', 800, size, 0, 0)
    bw, bt = (x1 - x0) * .54, size * .115
    gap = size * .07
    br_h = bw / 2 * .82 + bt / 2            # висота дужки від верхньої лінії
    total_h = (y1 - y0) + gap + br_h + bt / 2
    top = 512 - total_h / 2
    gx = 512 - (x0 + x1) / 2
    gy = top + br_h + bt / 2 + gap - y0
    fg = (f'<path d="{d}" fill="{ink}" transform="translate({gx:.1f} {gy:.1f})"/>'
          + breve(512, top + bt / 2, bw, bt, p))
    return icon(p, f'<rect width="1024" height="1024" fill="{bgc}"/>', fg)


def wordmark(p, ink='#15161A', muted='#8A8F99', size=120, font='unb', wght=760, dom=True, mark=None, gap=30, breve_color=None, mk=1.9):
    """Горизонтальний логотип: [знак] передай.com.ua; повертає (parts, w, top, bot)."""
    d, w, (x0, y0, x1, y1) = text_path(font, 'передаи', wght, size, 0, 0, track=-10 if font == 'unb' else -18)
    _, wi, (ix0, iy0, ix1, iy1) = text_path(font, 'и', wght, size, 0, 0)
    xh = -y0                                  # висота малих літер
    parts, xoff = [], 0
    top, bot = y0 - size * .34, size * .24
    if mark is not None:
        mh = xh * mk                           # знак — трохи вищий за малі літери
        s = mh / 1024
        my = -xh / 2 - mh / 2
        parts.append(f'<g transform="translate(0 {my:.1f}) scale({s:.4f})">{mark}</g>')
        xoff = mh + gap
        top, bot = min(top, my), max(bot, my + mh)
    parts.append(f'<path d="{d}" fill="{ink}" transform="translate({xoff:.1f} 0)"/>')
    cx = xoff + w - wi + (ix0 + ix1) / 2
    bw = (ix1 - ix0) * .66
    parts.append(breve(cx, y0 - size * .17, bw, size * .14, p, breve_color))
    tot = xoff + w
    if dom:
        dd, dw, _ = text_path(font, '.com.ua', 500 if font == 'unb' else 600, size * .42, tot + size * .06, 0)
        parts.append(f'<path d="{dd}" fill="{muted}"/>')
        tot += size * .06 + dw
    return parts, tot, top, bot


def lockup_svg(p, ink, muted, bg=None, font='unb', wght=760, mark=None, dom=True, pad=44, breve_color=None, mk=1.9, gap=30):
    parts, w, top, bot = wordmark(p, ink, muted, font=font, wght=wght, mark=mark, dom=dom, breve_color=breve_color, mk=mk, gap=gap)
    h = bot - top
    vb = f'{-pad} {top - pad:.1f} {w + 2 * pad:.1f} {h + 2 * pad:.1f}'
    r = f'<rect x="{-pad}" y="{top - pad:.1f}" width="{w + 2 * pad:.1f}" height="{h + 2 * pad:.1f}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{r}{"".join(parts)}</svg>'


# ═════ 6. Швейцарський мінімалізм — плаский «П.», один акцент ═════
def swiss_mark(ink='#111318', acc='#FF4F1F'):
    return f'<g transform="{CENTER}">' + pipe_shape(ink, dot=acc) + '</g>'


def swiss(p, mode='light'):
    if mode == 'light':
        return icon(p, '<rect width="1024" height="1024" fill="#FFFFFF"/>', swiss_mark() + f'<path d="{SQ}" fill="none" stroke="#E3E5EA" stroke-width="6"/>')
    if mode == 'accent':
        return icon(p, '<rect width="1024" height="1024" fill="#FF4F1F"/>', swiss_mark('#fff', '#111318'))
    return icon(p, '<rect width="1024" height="1024" fill="#111318"/>', swiss_mark('#F5F5F2', '#FF6A3A'))


def bare_mark(kind, p='bm'):
    """Знак без плитки — для горизонтальних логотипів (рамка знака = 1024)."""
    if kind == 'grad':
        return (f'<defs>{grad(p + "g", HOT_COLD)}</defs><g transform="{CENTER}">' + pipe_shape(f'url(#{p}g)')
                + glass_sphere(p + 's', DOT[0], DOT[1], DOT_R, shadow=False) + '</g>')
    return swiss_mark(*kind)


def inner(svg):
    return svg[svg.index('>') + 1:svg.rindex('</svg>')]


def tile_lockup(p, fn, mode, ink, muted, bg, **kw):
    return lockup_svg(p, ink, muted, bg, mark=inner(fn(p + 't', mode)), mk=2.5, gap=40, **kw)


# ═════════════════ Пак «Барабан»: маленький знак, шари, монохром, PNG, ZIP ═════════════════
NAVY, BLUE, RED, CELL, INK_D = '#0B1F6B', '#3A6BFF', '#FF3B3B', '#F4F6FB', '#0E1630'


def _digit(d, size, cx, cy, fill, wght=700):
    dd, _, (x0, y0, x1, y1) = text_path('unb', d, wght, size, 0, 0)
    return f'<path d="{dd}" fill="{fill}" transform="translate({cx - (x0 + x1) / 2:.1f} {cy - (y0 + y1) / 2:.1f})"/>'


def drum_mini(bleed=False):
    """Маленький знак (фавікон, шапка сайту): 3 барабани «4 2 7», плоскі кольори, без id — можна вставляти в сторінку скільки завгодно разів."""
    cw, ch, gap, pad = 232, 336, 22, 40
    w = 3 * cw + 2 * gap + 2 * pad
    h = ch + 2 * pad
    x0, y0 = 512 - w / 2, 512 - h / 2
    bg = (f'<rect width="1024" height="1024" fill="{BLUE}"/>' if bleed else f'<rect width="1024" height="1024" rx="232" fill="{BLUE}"/>')
    out = bg + f'<path d="M0 640 L1024 420 V1024 H0Z" fill="{NAVY}" opacity=".28"/>' if bleed else bg
    out += f'<rect x="{x0:.0f}" y="{y0:.0f}" width="{w:.0f}" height="{h:.0f}" rx="76" fill="#fff" fill-opacity=".22" stroke="#fff" stroke-opacity=".9" stroke-width="18"/>'
    for i, (d, red) in enumerate([('4', False), ('2', False), ('7', True)]):
        x = x0 + pad + i * (cw + gap)
        out += f'<rect x="{x:.0f}" y="{y0 + pad:.0f}" width="{cw}" height="{ch}" rx="40" fill="{RED if red else CELL}"/>'
        out += _digit(d, 300, x + cw / 2, 512, '#fff' if red else INK_D)
    return out


def drum_geom(n=4):
    cw, ch, gap = 158, 262, 18
    x0 = 512 - (n * cw + (n - 1) * gap) / 2
    y0 = 512 - ch / 2
    return cw, ch, gap, x0, y0


def drum_layers():
    """Шари для Apple Icon Composer (кожен — повне полотно 1024, решта прозора): фон, вікно (скло додасть система), барабани."""
    cw, ch, gap, x0, y0 = drum_geom()
    cap = (x0 - 40, y0 - 40, 4 * cw + 3 * gap + 80, ch + 80)
    bgl = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
           f'<stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{NAVY}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>')
    win = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="{cap[0]:.1f}" y="{cap[1]:.1f}" width="{cap[2]:.1f}" height="{cap[3]:.1f}" rx="66" fill="#FFFFFF"/></svg>')
    cells = ''
    for i, (d, red) in enumerate([('0', False), ('4', False), ('2', False), ('7', True)]):
        x = x0 + i * (cw + gap)
        cells += f'<rect x="{x:.1f}" y="{y0:.1f}" width="{cw}" height="{ch}" rx="26" fill="{RED if red else CELL}"/>' + _digit(d, 182, x + cw / 2, 512, '#fff' if red else '#12141C')
    drums = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{cells}</svg>'
    return {'1-background.svg': bgl, '2-window.svg': win, '3-drums.svg': drums}


def drum_mono(scale=1.0, fill='#fff', bg=None):
    """Монохром (Android «тематичні» іконки, iOS «тонована»): барабани одним кольором, цифри вирізані."""
    cw, ch, gap, x0, y0 = drum_geom()
    cells, digs = '', ''
    for i, d in enumerate('0427'):
        x = x0 + i * (cw + gap)
        cells += f'<rect x="{x:.1f}" y="{y0:.1f}" width="{cw}" height="{ch}" rx="26" fill="#fff"/>'
        digs += _digit(d, 182, x + cw / 2, 512, '#000')
    cap = (x0 - 40, y0 - 40, 4 * cw + 3 * gap + 80, ch + 80)
    t = f'translate({512 * (1 - scale):.1f} {512 * (1 - scale):.1f}) scale({scale})'
    b = f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{b}<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">'
            f'{cells}{digs}</mask></defs><g transform="{t}"><rect x="{cap[0]:.1f}" y="{cap[1]:.1f}" width="{cap[2]:.1f}" height="{cap[3]:.1f}" rx="66" fill="none" stroke="{fill}" stroke-width="16"/>'
            f'<rect width="1024" height="1024" fill="{fill}" mask="url(#m)"/></g></svg>')


def scaled(svg, scale, bg_svg=None):
    """Зменшити вміст SVG до scale по центру (безпечна зона Android/maskable), фон — повний."""
    body = inner(svg)
    t = f'translate({512 * (1 - scale):.1f} {512 * (1 - scale):.1f}) scale({scale})'
    bg = inner(bg_svg) if bg_svg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{bg}<g transform="{t}">{body}</g></svg>'


def drum_fg():
    """Передній шар адаптивної іконки Android: тільки скляне вікно з барабанами, без фону."""
    full = lg_drum('af', 'light', bleed=True)
    # прибираємо фон (два перші rect після defs фону)
    i = full.index('<rect width="1024" height="1024" fill="url(#afbg)"/>')
    j = full.index('<rect width="1024" height="1024" fill="url(#afbh)"/>') + len('<rect width="1024" height="1024" fill="url(#afbh)"/>')
    return full[:i] + full[j:]


def drum_bg():
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{NAVY}"/></linearGradient>'
            f'<radialGradient id="h" cx=".22" cy=".08" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="1024" height="1024" fill="url(#g)"/><rect width="1024" height="1024" fill="url(#h)"/></svg>')


def mini_svg(bleed=False, px=None):
    wh = f' width="{px}" height="{px}"' if px else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"{wh}>{drum_mini(bleed)}</svg>'


def render(jobs):
    """jobs: [(svg, size, path)] → PNG через Chromium (прозорість зберігається)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={'width': 64, 'height': 64}, device_scale_factor=1)
        for svg, size, path in jobs:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            pg.set_viewport_size({'width': size, 'height': size})
            pg.set_content(f'<html><body style="margin:0;background:transparent">'
                           f'<img style="display:block;width:{size}px;height:{size}px" src="data:image/svg+xml;base64,{__import__("base64").b64encode(svg.encode()).decode()}"></body></html>')
            pg.wait_for_load_state('load')
            pg.screenshot(path=path, omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
        b.close()


README = '''Лічильники · peredai.com.ua — логотип «Барабан»
=================================================
Знак — віконце лічильного механізму, як на водомірі: чорні барабани — кубометри, червоний — літри, остання цифра докручується.

ios/AppIcon.appiconset/   — для Xcode: 1024 світла, темна, тонована (Contents.json уже є; iOS сама робить заокруглення)
ios/icon-composer-layers/ — шари для Apple Icon Composer (iOS 26+, «рідке скло»): 1-background, 2-window, 3-drums — перетягніть у Icon Composer,
                            вікну ввімкніть Liquid Glass, барабанам — непрозорість 100 %
ios/sizes/                — готові PNG усіх розмірів (20…1024) для інших інструментів
android/res/              — скопіюйте в app/src/main/res: адаптивна іконка (передній шар, фон, монохром для «тематичних» іконок Android 13+),
                            mipmap-*/ic_launcher.png і ic_launcher_round.png для старих Android, mipmap-anydpi-v26/ic_launcher.xml
android/play-store-512.png — іконка для Google Play (Play сам заокруглює)
web/                      — favicon.ico, favicon.svg, apple-touch-icon.png (180), icon-192/512, maskable-512, manifest.json — уже на сайті
telegram/bot-avatar-640.png — аватар бота: @BotFather → /setuserpic → оберіть бота → надішліть цей файл (Telegram обріже по колу — вікно влазить)
svg/                      — вихідні векторні файли: іконка світла/темна, малий знак, горизонтальний логотип світлий/темний

Кольори: синій #3A6BFF → ніч #0B1F6B, літри #FF3B3B, барабан #F4F6FB, цифри #12141C. Шрифт цифр — Unbounded (OFL), переведено в криві.
Згенеровано tools_logo.py (репозиторій teplo_test).
'''


def build_pack(root):
    import zipfile, json as _j, shutil, tempfile
    from PIL import Image
    web = os.path.join(root, 'web', 'icon')
    os.makedirs(web, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='peredai-icons-')
    P = lambda *a: os.path.join(tmp, *a)
    light, dark = lg_drum('il', 'light'), lg_drum('id', 'dark')
    bl, bd = lg_drum('bl', 'light', bleed=True), lg_drum('bd', 'dark', bleed=True)
    tinted = drum_mono(1.0, '#fff', '#000')
    mini, mini_b = mini_svg(), mini_svg(True)
    fg, bgs, mono = drum_fg(), drum_bg(), drum_mono(.8)
    jobs = []
    # iOS
    for f, s in (('icon-1024.png', bl), ('icon-1024-dark.png', bd), ('icon-1024-tinted.png', tinted)):
        jobs.append((s, 1024, P('ios', 'AppIcon.appiconset', f)))
    for sz in (20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180):
        jobs.append((bl, sz, P('ios', 'sizes', f'icon-{sz}.png')))
    # Android: адаптивна (108 dp; вміст — у безпечних 66 dp → масштаб .8 від нашого вікна, що займає ~75 % ширини)
    fgs, monos = scaled(fg, .8), mono
    for dpi, k in (('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)):
        a = int(108 * k)
        jobs += [(fgs, a, P('android', 'res', f'mipmap-{dpi}', 'ic_launcher_foreground.png')),
                 (bgs, a, P('android', 'res', f'mipmap-{dpi}', 'ic_launcher_background.png')),
                 (monos, a, P('android', 'res', f'mipmap-{dpi}', 'ic_launcher_monochrome.png')),
                 (light, int(48 * k), P('android', 'res', f'mipmap-{dpi}', 'ic_launcher.png')),
                 (bl.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
                             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="rc"><circle cx="512" cy="512" r="512"/></clipPath></defs><g clip-path="url(#rc)">', 1).replace('</svg>', '</g></svg>'),
                  int(48 * k), P('android', 'res', f'mipmap-{dpi}', 'ic_launcher_round.png'))]
    jobs.append((bl, 512, P('android', 'play-store-512.png')))
    # веб і Telegram
    jobs += [(mini, 16, P('web', 'favicon-16.png')), (mini, 32, P('web', 'favicon-32.png')), (mini, 48, P('web', 'favicon-48.png')),
             (bl, 180, P('web', 'apple-touch-icon.png')), (light, 192, P('web', 'icon-192.png')), (light, 512, P('web', 'icon-512.png')),
             (scaled(fg, .8, bgs), 512, P('web', 'icon-maskable-512.png')), (bl, 640, P('telegram', 'bot-avatar-640.png'))]
    render(jobs)
    try:   # без втрат стискає вдвічі-втричі (Chromium згладжує градієнти шумом)
        import oxipng
        for _, _, path in jobs:
            oxipng.optimize(path, level=3)
    except ImportError:
        pass
    Image.open(P('web', 'favicon-48.png')).save(P('web', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    # тексти
    W = lambda path, txt: (os.makedirs(os.path.dirname(path), exist_ok=True), open(path, 'w', encoding='utf-8').write(txt))
    W(P('ios', 'AppIcon.appiconset', 'Contents.json'), _j.dumps({'images': [
        {'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
        {'appearances': [{'appearance': 'luminosity', 'value': 'dark'}], 'filename': 'icon-1024-dark.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
        {'appearances': [{'appearance': 'luminosity', 'value': 'tinted'}], 'filename': 'icon-1024-tinted.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
        'info': {'author': 'xcode', 'version': 1}}, indent=2))
    for n, s in drum_layers().items():
        W(P('ios', 'icon-composer-layers', n), s)
    W(P('android', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
      '    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
      '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
    shutil.copy(P('android', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'), P('android', 'res', 'mipmap-anydpi-v26', 'ic_launcher_round.xml'))
    manifest = {'name': 'Лічильники — peredai.com.ua', 'short_name': 'Лічильники', 'lang': 'uk', 'start_url': '../../', 'scope': '../../',
                'display': 'browser', 'background_color': '#E9EEEB', 'theme_color': '#E9EEEB',
                'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'}, {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
                          {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}, {'src': 'favicon.svg', 'sizes': 'any', 'type': 'image/svg+xml'}]}
    W(P('web', 'manifest.json'), _j.dumps(manifest, ensure_ascii=False, indent=1))
    W(P('web', 'favicon.svg'), mini)
    W(P('svg', 'icon-light.svg'), light)
    W(P('svg', 'icon-dark.svg'), dark)
    W(P('svg', 'icon-small.svg'), mini)
    W(P('svg', 'logo-light.svg'), tile_lockup('ll', lg_drum, 'light', '#10183A', '#8A8F99', None))
    W(P('svg', 'logo-dark.svg'), tile_lockup('ld', lg_drum, 'dark', '#F2F4F8', '#7D828C', None))
    W(P('README.txt'), README)
    # на сайт — веб-набір + сам пак
    for f in ('favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.json'):
        shutil.copy(P('web', f), os.path.join(web, f))
    shutil.copy(P('web', 'favicon.ico'), os.path.join(root, 'favicon.ico'))
    shutil.copy(P('web', 'apple-touch-icon.png'), os.path.join(root, 'apple-touch-icon.png'))
    zp = os.path.join(web, 'peredai-icons.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
        for dp, _, fs in os.walk(tmp):
            for f in sorted(fs):
                full = os.path.join(dp, f)
                zi = zipfile.ZipInfo('peredai-icons/' + os.path.relpath(full, tmp), (2026, 11, 12, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(zi, open(full, 'rb').read())
    shutil.rmtree(tmp)
    return zp


def wordmark_inline(size=100):
    """Слово «передай» (варіант 5) для сторінки: шляхи, дужка над «й», «.com.ua» — числа округлені, колір задає сторінка (currentColor)."""
    import re
    rnd = lambda d: re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), d)
    d, w, (x0, y0, x1, y1) = text_path('unb', 'передаи', 760, size, 0, 0, track=-10)
    _, wi, (ix0, iy0, ix1, iy1) = text_path('unb', 'и', 760, size, 0, 0)
    cx = w - wi + (ix0 + ix1) / 2
    bw, t = (ix1 - ix0) * .64, size * .13
    r, top = bw / 2, y0 - size * .25           # дужка трохи вище, ніж у великому логотипі: на 19 px інакше зливається з «и»
    b = f'M{cx - r:.1f} {top:.1f}A{r:.1f} {r * .82:.1f} 0 0 0 {cx + r:.1f} {top:.1f}'
    dx = w + size * .06
    dd, dw, _ = text_path('unb', '.com.ua', 500, size * .42, dx, 0)
    vt, vb_ = top - t / 2 - 1, y1 + 1
    out = {'d': rnd(d), 'b': b, 'bw': round(t, 1), 'g': [round(cx - r - t, 1), round(cx + r + t, 1)], 'dom': rnd(dd),
           'vb': f'{min(x0, 0) - 1:.1f} {vt:.1f} {w + 2:.1f} {vb_ - vt:.1f}', 'vbd': f'{min(x0, 0) - 1:.1f} {vt:.1f} {dx + dw + 2:.1f} {vb_ - vt:.1f}',
           'xh': round(-y0 / (vb_ - vt), 3)}
    return out


if __name__ == '__main__':
    import sys
    if '--inline' in sys.argv:
        print(inner(mini_svg()))
    elif '--wordmark' in sys.argv:
        print(json.dumps(wordmark_inline(), ensure_ascii=False))
    else:
        print(build_pack(HERE))
