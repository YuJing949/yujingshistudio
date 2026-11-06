"""Normalise every Blue artboard to one scale.

Type      13 / 18   small      (meta, hints)
          16 / 22   secondary  (links, short body)
          18 / 24   body + button labels
          31 / 39   title      (sheets, cards, dialogs)
          46 / 59   display    (screen titles)
Controls  69  primary pill / circle (user's Save, record, heart)
          56  secondary pill / circle, inputs, list rows
          44  small (copy, download)
Radius    full round for every control; 34 cards; 42 panels, sheets, dialogs
Margins   page text 28 (titles) / 30 (body, optical); panel and sheet content 38
"""
import re, os, shutil, sys

SRC = sys.argv[1]
OUT = sys.argv[2]
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)

FONT = {14: 13, 15: 16, 17: 18, 19: 18, 20: 18, 26: 31}
LINE = {13: 18, 16: 22, 18: 24, 31: 39}
HALF = {36: 44, 50: 56, 52: 56, 60: 56, 64: 69, 72: 69}   # pills with radius = h/2
CIRCLE = {36: 44, 52: 56}                                  # radius 50%
KB_START = '<div aria-hidden="true" style="position: absolute; left: 0; top: 553px; width: 390px; height: 291px'

num = lambda v: float(v)
fmt = lambda v: (f'{v:.1f}'.rstrip('0').rstrip('.'))


def props(style):
    out = []
    for part in style.split(';'):
        if ':' in part:
            k, v = part.split(':', 1)
            out.append([k.strip(), v.strip()])
        elif part.strip():
            out.append([part.strip(), None])
    last = {}
    for k, v in out:          # a later duplicate wins in CSS, so keep it in the first slot
        last[k] = v
    seen, merged = set(), []
    for k, v in out:
        if k not in seen:
            seen.add(k); merged.append([k, last[k]])
    return merged


def get(ps, key):
    for k, v in ps:
        if k == key:
            return v
    return None


def put(ps, key, val):
    for p in ps:
        if p[0] == key:
            p[1] = val
            return
    ps.append([key, val])


def px(v):
    m = re.fullmatch(r'(-?\d+(?:\.\d+)?)px', v or '')
    return float(m.group(1)) if m else None


changes = {'font': 0, 'line': 0, 'control': 0, 'sheet': 0}


def fix_style(style):
    ps = props(style)
    fs = px(get(ps, 'font-size'))
    if fs is not None and int(fs) == fs and int(fs) in FONT:
        new = FONT[int(fs)]
        put(ps, 'font-size', f'{new}px'); changes['font'] += 1
        if fs == 26:
            put(ps, 'line-height', '39px'); put(ps, 'letter-spacing', '-0.3px')
            put(ps, 'white-space', 'nowrap'); put(ps, 'overflow', 'hidden'); put(ps, 'text-overflow', 'ellipsis')
        fs = new
    lh = px(get(ps, 'line-height'))
    if fs is not None and lh is not None and int(fs) in LINE and lh != LINE[int(fs)] and fs != 46:
        put(ps, 'line-height', f'{LINE[int(fs)]}px'); changes['line'] += 1
    h = px(get(ps, 'height'))
    r = get(ps, 'border-radius')
    if h is not None and int(h) == h:
        h = int(h); new = None
        if r == '50%' and h in CIRCLE:
            new = CIRCLE[h]
        elif px(r) is not None and abs(px(r) - h / 2) < .01 and h in HALF:
            new = HALF[h]
        if new:
            d = new - h
            put(ps, 'height', f'{new}px')
            if r != '50%':
                put(ps, 'border-radius', f'{fmt(new / 2)}px')
            w = px(get(ps, 'width'))
            if w is not None and w == h:
                put(ps, 'width', f'{new}px')
                if px(get(ps, 'left')) is not None:
                    put(ps, 'left', f'{fmt(px(get(ps, "left")) - d / 2)}px')
            if px(get(ps, 'top')) is not None:
                put(ps, 'top', f'{fmt(px(get(ps, "top")) - d / 2)}px')
            changes['control'] += 1
    return '; '.join(k if v is None else f'{k}: {v}' for k, v in ps)


for name in sorted(os.listdir(SRC)):
    if not (name.startswith('Blue') and name.endswith('.dc.html')):
        continue
    s = open(f'{SRC}/{name}').read()
    kb = None
    if KB_START in s:
        a = s.index(KB_START); b = s.index('</div>', a) + 6
        kb, s = s[a:b], s[:a] + '@@KEYBOARD@@' + s[b:]
    # sheets: content lines up with panel content (x = 38)
    for old, new in [('padding: 28px 26px 0; border-radius: 42px', 'padding: 28px 29px 0; border-radius: 42px'),
                     ('<h2 id="code-title" style="position: absolute; left: 26px;', '<h2 id="code-title" style="position: absolute; left: 29px;'),
                     ('style="position: absolute; left: 26px; top: 156px;', 'style="position: absolute; left: 29px; top: 156px;'),
                     ('style="position: absolute; left: 20px; top: 82px; width: 332px;', 'style="position: absolute; left: 20px; top: 82px; width: 332px;')]:
        if old in s:
            s = s.replace(old, new); changes['sheet'] += 1
    s = re.sub(r'style="([^"]*)"', lambda m: 'style="' + fix_style(m.group(1)) + '"', s)
    if kb:
        s = s.replace('@@KEYBOARD@@', kb)
    open(f'{OUT}/{name}', 'w').write(s)

print(changes)
