"""Render the README banner and feature cards (same look as acnh-qol-peanuts) with headless Chrome.
Usage: python tools/make_art.py   (needs Chrome and Pillow; writes docs/img/)"""
import os, subprocess, tempfile
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'docs', 'img')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
FONTS = '<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito:wght@500;700;800&display=swap" rel="stylesheet">'
LEAF = ('<svg viewBox="0 0 64 64"><path d="M30 6C13 16 7 37 18 55c20 2 36-14 36-34C48 11 40 7 30 6z" fill="#6dbb4f"/>'
        '<path d="M18 55C24 40 31 28 44 16" fill="none" stroke="#4b9435" stroke-width="3.5" stroke-linecap="round"/>'
        '<path d="M18 55l-6 6" stroke="#8a6a43" stroke-width="4" stroke-linecap="round"/>'
        '<path d="M27 40l-7-4M33 31l-6-6M33 31l9 1M27 40l10 2" stroke="#4b9435" stroke-width="2.5" stroke-linecap="round"/></svg>')
GRASS = ("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='%23b9dc9b'%3E"
         "%3Cpath d='M30 12c-9 6-11 17-5 26 9 0 15-8 14-18-2-4-5-7-9-8z'/%3E%3Cpath d='M90 72c-9 6-11 17-5 26 9 0 15-8 14-18-2-4-5-7-9-8z' transform='rotate(35 90 85)'/%3E"
         "%3C/g%3E%3Cg fill='%23ffffff' opacity='.45'%3E%3Ccircle cx='88' cy='22' r='3'/%3E%3Ccircle cx='24' cy='88' r='3'/%3E%3C/g%3E%3C/svg%3E\")")

# (file, title, bullets, accent): accent green for features, orange for the honest "not yet" card
CARDS = [
    ('new-stuff', 'Jubbsticks\' Additions', ['New items, new NPCs and new interactions',
                                            'Lots to discover and unlock', 'English only for now'], '#6dbb4f'),
    ('stacks', 'Stacks to 254', ['Fish, bugs, dive fish, clams and trash all stack',
                                 'Every stack limit goes up to 254, the game\'s cap',
                                 'Done with romfs edits only (dragonloverlord\'s addition)'], '#6dbb4f'),
    ('combined', 'Works with ACNH-Combined', ['Keeps Combined\'s doubled Daily rewards and banana names',
                                              'Combined\'s flower and fruit models stay Combined\'s',
                                              'One merged size table for all three mods'], '#6dbb4f'),
    ('port', 'From the port', ['All tools are unbreakable',
                               'The new tool and balloon DIYs stay out of hotel delivery requests'], '#6dbb4f'),
    ('not-yet', 'Not working on Peanuts yet', ['The port\'s EventFlow and extra message files, so some new NPC dialogue is missing',
                                                'Its UnitIcon models',
                                                'They crash or hang ACNH 3.0.3 on Peanuts, so the patcher leaves them out for now'], '#f2a541'),
]

CARD_CSS = """
body { margin: 0; padding: 14px; background: transparent; width: 1000px; box-sizing: border-box; }
.c { position: relative; background: #fff8e8; border-radius: 26px; padding: 22px 34px 22px 50px; overflow: hidden;
     box-shadow: 0 5px 0 #e6dbbb, 0 12px 22px rgba(75, 110, 50, .14); }
.c::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: var(--a); }
h2 { margin: 0 0 8px; font: 600 34px/1.2 Fredoka, sans-serif; color: var(--a); }
ul { margin: 0; padding: 0; list-style: none; }
li { position: relative; padding-left: 28px; font: 800 21px/1.7 Nunito, sans-serif; color: #6b5236; }
li::before { content: ""; position: absolute; left: 2px; top: .62em; width: 11px; height: 11px; border-radius: 50%; background: var(--a); }
"""

BANNER = f"""<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>
body {{ margin: 0; width: 1280px; height: 480px; overflow: hidden; background-color: #cfe8b6; background-image: {GRASS}; background-size: 150px; position: relative; }}
.card {{ position: absolute; left: 48px; top: 58px; width: 760px; background: #fff8e8; border-radius: 30px; padding: 34px 40px 30px;
        box-shadow: 0 6px 0 #e6dbbb, 0 18px 40px rgba(75,110,50,.25); }}
.badge {{ position: absolute; left: -22px; top: -30px; width: 92px; height: 92px; border-radius: 50%; background: #fff8e8; display: grid; place-items: center;
         box-shadow: 0 4px 0 #e6dbbb, 0 10px 24px rgba(75,110,50,.2); }}
.badge svg {{ width: 56px; height: 56px; }}
.kick {{ display: inline-block; margin-left: 52px; padding: 3px 14px; border-radius: 999px; background: #6dbb4f; color: #fff; font: 800 17px/1.5 Nunito, sans-serif; letter-spacing: .03em; }}
.unoff {{ display: inline-block; margin-left: 8px; padding: 3px 14px; border-radius: 999px; background: #f2a541; color: #fff; font: 800 17px/1.5 Nunito, sans-serif; letter-spacing: .03em; }}
h1 {{ margin: 14px 0 6px; font: 600 54px/1.08 Fredoka, sans-serif; color: #6b5236; }}
h1 b {{ color: #4b9435; font-weight: 600; }}
.sub {{ margin: 0 0 18px; font: 800 22px/1.4 Nunito, sans-serif; color: #95805f; }}
.pills {{ display: flex; flex-wrap: wrap; gap: 10px; }}
.pills span {{ padding: 5px 16px; border-radius: 999px; background: #fff; border: 3px solid #6dbb4f; box-shadow: 0 3px 0 #6dbb4f; color: #4b9435; font: 600 19px/1.3 Fredoka, sans-serif; }}
.big {{ position: absolute; right: 60px; top: 70px; width: 340px; height: 340px; opacity: .95; transform: rotate(-12deg); }}
</style></head><body>
<svg class="big" viewBox="0 0 64 64">{LEAF[24:]}
<div class="card"><div class="badge">{LEAF}</div>
<span class="kick">ACNH 3.0.3 &middot; PEANUTS NATIVE</span><span class="unoff">UNOFFICIAL BETA</span>
<h1>Jubbsticks' Additions<br><b>for Peanuts</b></h1>
<p class="sub">dragonloverlord's unofficial port, running on Android</p>
<div class="pills"><span>New items</span><span>New NPCs</span><span>Stacks to 254</span><span>Works with Combined</span></div>
</div></body></html>"""


def shot(html, out, w, h, crop):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'a.html'); open(p, 'w', encoding='utf-8').write(html)
        png = os.path.join(d, 'a.png')
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                        '--default-background-color=00000000', '--virtual-time-budget=4000', f'--window-size={w},{h}',
                        f'--screenshot={png}', 'file:///' + p.replace('\\', '/')], check=True, capture_output=True)
        im = Image.open(png).convert('RGBA')
    if crop:
        box = im.getchannel('A').point(lambda a: 255 if a > 0 else 0).getbbox()
        im = im.crop((0, 0, w, min(h, box[3] + 4)))
    im.save(out, optimize=True); print(out, im.size)


os.makedirs(os.path.join(IMG, 'features'), exist_ok=True)
shot(BANNER, os.path.join(IMG, 'banner.png'), 1280, 480, False)
for name, title, items, acc in CARDS:
    html = (f'<!doctype html><html><head><meta charset="utf-8">{FONTS}<style>{CARD_CSS}</style></head>'
            f'<body><div class="c" style="--a:{acc}"><h2>{title}</h2><ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul></div></body></html>')
    shot(html, os.path.join(IMG, 'features', name + '.png'), 1000, 600, True)
