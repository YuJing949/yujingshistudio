"""End-to-end test for SoundRoute in headless Chromium, with a fake Supabase.

Usage (from the repo root):
    pip install playwright && playwright install chromium
    (cd soundtrack && python3 -m http.server 8765) &
    python3 tests/soundroute/run.py

The real Supabase client (loaded from cdn.jsdelivr.net) is replaced by
fake-supabase.js, which keeps its data in localStorage. GPS, microphone and
compass are simulated. Screenshot: tests/soundroute/out/e2e.png
"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
FAKE=open(os.path.join(HERE,'fake-supabase.js')).read()
BASE='http://localhost:8765/index.html'
def log(pg): return pg.evaluate("document.getElementById('debugLogPre').textContent")
with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--autoplay-policy=no-user-gesture-required"])
    ctx=b.new_context(viewport={'width':390,'height':844},geolocation={'latitude':51.48650,'longitude':-0.12350,'accuracy':8},permissions=['geolocation','microphone'])
    ctx.add_init_script("try { localStorage.setItem('soundroute-guide','seen'); localStorage.setItem('soundroute-home-banner','dismissed'); } catch (e) {}")
    ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=FAKE))
    names=iter(["Test walk A","Test walk B","Offline walk C"])
    pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.on('dialog',lambda d: d.accept(next(names)) if d.type=='prompt' else d.accept())
    pg.goto(BASE); pg.wait_for_timeout(2000)
    print('1 cloud:', pg.inner_text('#cloudText'))

    def walk(seconds, heading=0, listen=False):
        pg.click('#startBtn'); pg.wait_for_timeout(3500)
        if listen: pg.click('#listenToggleBtn')
        lat=51.48650
        for i in range(seconds):
            lat+=0.000012  # ~1.3 m north per second
            ctx.set_geolocation({'latitude':lat,'longitude':-0.12350,'accuracy':8})
            pg.evaluate(f"""()=>{{const e=new Event('deviceorientation'); Object.defineProperty(e,'webkitCompassHeading',{{value:{heading}}}); Object.defineProperty(e,'alpha',{{value:0}}); Object.defineProperty(e,'beta',{{value:80}}); Object.defineProperty(e,'gamma',{{value:0}}); window.dispatchEvent(e);}}""")
            pg.wait_for_timeout(1000)
        print('   status during walk:', pg.inner_text('#statusText'), '| points:', pg.inner_text('#nodesCount'))
        pg.evaluate("window.__lastPlayback = document.getElementById('playbackText').textContent")
        pg.click('#endBtn'); pg.wait_for_timeout(3000)

    walk(12)
    print('2 after walk A:', pg.inner_text('#nodesList').replace('\n',' | ')[:220])
    db=pg.evaluate("JSON.parse(localStorage.getItem('fake-supabase-db'))")
    print('  cloud rows:', [(r['name'],r['share_code'],r['duration_s']) for r in db['routes']], 'points:', len(db['points']), 'files:', len(db['files']))

    pg.reload(); pg.wait_for_timeout(2500)
    print('3 after reload, my walks:', pg.inner_text('#routesList').replace('\n',' | '))
    print('  audio src kind:', pg.evaluate("document.querySelector('#nodesList audio')?.src.slice(0,22)"))

    # walk B from same start, listening
    ctx.set_geolocation({'latitude':51.48650,'longitude':-0.12350,'accuracy':8}); pg.wait_for_timeout(500)
    walk(10, listen=True)
    L=log(pg); lines=[l[15:] for l in L.split('\n') if '[listen]' in l and ('play' in l or 'start' in l or 'switch' in l or 'resync' in l or 'stop' in l)]
    print('4 listen events:', lines[:6])
    print('  playback text at end of walk B:', pg.evaluate("window.__lastPlayback || ''"))

    # offline walk C
    pg.evaluate("localStorage.setItem('fake-fail-upload','1')")
    walk(6)
    print('5 offline walk C:', pg.inner_text('#nodesList').replace('\n',' | ')[:200])
    pg.evaluate("localStorage.removeItem('fake-fail-upload')")
    pg.reload(); pg.wait_for_timeout(4000)
    print('6 after reload (retry):', pg.inner_text('#routesList').replace('\n',' | '))

    # delete walk A
    pg.click("#routesList li:has-text('Test walk A') button"); pg.wait_for_timeout(300)
    pg.click('#deleteRouteBtn'); pg.wait_for_timeout(1500)
    db=pg.evaluate("JSON.parse(localStorage.getItem('fake-supabase-db'))")
    print('7 after delete:', pg.inner_text('#routesList').replace('\n',' | '), '| cloud rows:', [r['name'] for r in db['routes']], 'files:', len(db['files']))
    print('page errors:', errs)
    os.makedirs(os.path.join(HERE,'out'),exist_ok=True); pg.screenshot(path=os.path.join(HERE,'out','e2e.png'), full_page=True)
    b.close()
