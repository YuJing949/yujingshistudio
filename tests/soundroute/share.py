"""End-to-end test for My map (phase 5) and City plaza (phase 6), two people.

Usage (from the repo root, server running as for run.py):
    python3 tests/soundroute/share.py

Person A records two walks, renames one and makes it public, keeps the other
private. Person B finds the public walk in the City plaza, previews and saves
it, saves the private one by share code, hears a saved walk while walking,
then removes one. Screenshots: tests/soundroute/out/plaza.png, saved.png
"""
import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, "fake-supabase.js")).read()
BASE = "http://localhost:8765/index.html"
START = (51.48650, -0.12350)
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, geolocation={"latitude": START[0], "longitude": START[1], "accuracy": 8}, permissions=["geolocation", "microphone"])
    ctx.add_init_script("try { localStorage.setItem('soundroute-guide','seen'); localStorage.setItem('soundroute-home-banner','dismissed'); } catch (e) {}")
    ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=FAKE))
    answers = []
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("dialog", lambda d: d.accept(answers.pop(0) if (d.type == "prompt" and answers) else None) if d.type == "prompt" else d.accept())

    def orient(h=0):
        pg.evaluate(f"()=>{{const e=new Event('deviceorientation');Object.defineProperty(e,'webkitCompassHeading',{{value:{h}}});window.dispatchEvent(e)}}")

    def walk(name, seconds, lng=START[1], listen=False):
        ctx.set_geolocation({"latitude": START[0], "longitude": lng, "accuracy": 8})
        if listen:
            pg.click("#listenToggleBtn")
        pg.click("#startBtn")
        pg.wait_for_timeout(3500)
        lat = START[0]
        heard = []
        for _ in range(seconds):
            lat += 0.000012
            ctx.set_geolocation({"latitude": lat, "longitude": lng, "accuracy": 8})
            orient()
            pg.wait_for_timeout(1000)
            heard.append(pg.inner_text("#playbackText"))
        answers.append(name)
        pg.click("#endBtn")
        pg.wait_for_timeout(3000)
        return heard

    def walk_panel():
        return pg.inner_text("#nodesList").replace("\n", " | ")

    def as_person(user_id):
        pg.evaluate(f"localStorage.setItem('fake-uid', '{user_id}')")
        pg.reload()
        pg.wait_for_timeout(2500)

    pg.goto(BASE)
    pg.wait_for_timeout(500)
    as_person("person-a")

    # ── Person A ──
    walk("Canal walk", 8)
    walk("Secret garden", 6, lng=START[1] + 0.02)  # ~1.4 km east: a second plaza cell
    pg.click("#routesList li:has-text('Canal walk') button")
    answers.append("Canal at dusk")
    pg.click("#nodesList button:has-text('Rename')")
    pg.wait_for_timeout(500)
    pg.click("#nodesList button:has-text('Make public')")
    pg.wait_for_timeout(500)
    print("A1 public walk:", walk_panel()[:160])
    pg.click("#routesList li:has-text('Secret garden') button")
    secret_code = pg.inner_text("#nodesList").split("Share code")[1].split("\n")[1].strip()
    print("A2 private walk code:", secret_code)

    # ── Person B ──
    as_person("person-b")
    print("B1 my walks:", pg.inner_text("#routesList") or "(none)", "| saved:", pg.inner_text("#savedEmpty")[:40])
    pg.click("#tabPlaza")
    pg.wait_for_timeout(1500)
    print("B2 plaza:", pg.inner_text("#plazaSummary"))
    pg.screenshot(path=os.path.join(OUT, "plaza.png"))
    box = pg.locator("#plazaCanvas").bounding_box()
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.wait_for_timeout(1200)
    print("B3 walks in the light:", pg.inner_text("#plazaList").replace("\n", " | "))
    pg.click("#plazaList button:has-text('Listen')")
    pg.wait_for_timeout(1500)
    print("B4 preview playing:", pg.evaluate("[...document.querySelectorAll('#plazaList button')].map(b=>b.textContent)"))
    pg.click("#plazaList button:has-text('Save')")
    pg.wait_for_timeout(1500)
    print("B5 after save:", pg.evaluate("[...document.querySelectorAll('#plazaList button')].map(b=>b.textContent)"))
    pg.click("#tabMap")
    pg.fill("#codeInput", "nope-nope-0000")
    pg.click("#codeBtn")
    pg.wait_for_timeout(800)
    print("B6 bad code:", pg.inner_text("#codeStatus"))
    pg.fill("#codeInput", secret_code)
    pg.click("#codeBtn")
    pg.wait_for_timeout(1500)
    print("B7 good code:", pg.inner_text("#codeStatus"), "| saved list:", pg.inner_text("#savedList").replace("\n", " | "))
    heard = walk("B's first walk", 6, listen=True)
    log = pg.evaluate("document.getElementById('debugLogPre').textContent")
    events = [l[15:] for l in log.split("\n") if "[listen] start" in l or "[listen] switch" in l]
    print("B8 heard while walking:", events[:2] or heard[1:3])
    pg.click("#savedList li:has-text('Secret garden') button")
    pg.click("#nodesList button:has-text('Remove from saved')")
    pg.wait_for_timeout(1200)
    print("B9 saved after removing:", pg.inner_text("#savedList").replace("\n", " | "))
    pg.reload()
    pg.wait_for_timeout(2500)
    print("B10 after reload, saved:", pg.inner_text("#savedList").replace("\n", " | "))
    pg.screenshot(path=os.path.join(OUT, "saved.png"), full_page=True)

    # ── Person A deletes the public walk: gone for B too ──
    as_person("person-a")
    pg.click("#routesList li:has-text('Canal at dusk') button")
    pg.click("#deleteRouteBtn")
    pg.wait_for_timeout(1500)
    as_person("person-b")
    print("B11 saved after A deleted:", pg.inner_text("#savedList") or "(none)")
    pg.click("#tabPlaza")
    pg.wait_for_timeout(1500)
    print("B12 plaza:", pg.inner_text("#plazaSummary"))
    print("page errors:", errors)
    b.close()
