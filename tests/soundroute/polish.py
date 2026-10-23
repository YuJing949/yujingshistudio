"""End-to-end test for phase 7: first-time guide, Home Screen banner, private
start, reporting (three reports hide a walk), and linking an email.

Usage (from the repo root, server running as for run.py):
    python3 tests/soundroute/polish.py
The fake Supabase accepts the code 123456. Screenshot: out/guide.png
"""
import json
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
    ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=FAKE))
    answers = []
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("dialog", lambda d: d.accept(answers.pop(0) if answers else "") if d.type == "prompt" else d.accept())
    visible = lambda sel: pg.evaluate(f"!document.querySelector('{sel}').hidden")

    # ── First visit: guide ──
    pg.goto(BASE)
    pg.wait_for_timeout(1500)
    print("1 guide on first visit:", visible("#guide"))
    titles = []
    for _ in range(4):
        titles.append(pg.evaluate("[...document.querySelectorAll('.guide-step')].find(s=>!s.hidden).querySelector('h2').textContent"))
        if visible("#guideNext"):
            pg.click("#guideNext")
    print("  steps:", titles)
    pg.screenshot(path=os.path.join(OUT, "guide.png"))
    pg.click("#guidePlaza")
    pg.wait_for_timeout(800)
    print("2 'Explore the City plaza' → guide closed:", not visible("#guide"), "| plaza shown:", visible("#plazaView"))
    pg.reload()
    pg.wait_for_timeout(1500)
    print("3 guide after reload (expect False):", visible("#guide"))
    pg.click("#helpBtn")
    print("  help button reopens guide:", visible("#guide"))
    pg.click("#guideSkip")
    print("4 home banner shown:", visible("#homeBanner"))
    pg.click("#homeBannerClose")
    pg.reload()
    pg.wait_for_timeout(1500)
    print("  banner after dismiss + reload (expect False):", visible("#homeBanner"))
    print("  manifest linked:", pg.evaluate("!!document.querySelector('link[rel=manifest]')"),
          "| manifest loads:", pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json()).then(j=>j.name)"))

    def orient():
        pg.evaluate("()=>{const e=new Event('deviceorientation');Object.defineProperty(e,'webkitCompassHeading',{value:0});window.dispatchEvent(e)}")

    def walk(name, seconds):
        ctx.set_geolocation({"latitude": START[0], "longitude": START[1], "accuracy": 8})
        pg.click("#tabMap")
        pg.click("#startBtn")
        pg.wait_for_timeout(3500)
        lat = START[0]
        for _ in range(seconds):
            lat += 0.00003  # ~3.3 m north per second
            ctx.set_geolocation({"latitude": lat, "longitude": START[1], "accuracy": 8})
            orient()
            pg.wait_for_timeout(1000)
        answers.append(name)
        pg.click("#endBtn")
        pg.wait_for_timeout(3000)

    def as_person(user_id):
        pg.evaluate(f"localStorage.setItem('fake-uid', '{user_id}')")
        pg.reload()
        pg.wait_for_timeout(2500)

    # ── Private start ──
    as_person("person-a")
    walk("Long walk", 30)  # ~100 m
    db = pg.evaluate("JSON.parse(localStorage.getItem('fake-supabase-db'))")
    route = db["routes"][0]
    pts = sorted([pt for pt in db["points"] if pt["route_id"] == route["id"]], key=lambda q: q["t"])
    first_m = (pts[0]["lat"] - START[0]) * 111320
    print("5 private start: first stored point is", round(first_m), "m from where the walk began (expect >= 25)")
    pg.click("#routesList li:has-text('Long walk') button")
    pg.click("#nodesList button:has-text('Make public')")
    pg.wait_for_timeout(600)

    # ── Three reports hide it ──
    for person in ["person-b", "person-c", "person-d"]:
        as_person(person)
        pg.click("#tabPlaza")
        pg.wait_for_timeout(1200)
        box = pg.locator("#plazaCanvas").bounding_box()
        pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.wait_for_timeout(1000)
        answers.append("test report")
        pg.click("#plazaList button:has-text('Report')")
        pg.wait_for_timeout(800)
        print(f"6 {person} reported:", pg.inner_text("#plazaSummary"),
              "| buttons:", pg.evaluate("[...document.querySelectorAll('#plazaList button')].map(b=>b.textContent)"))
    as_person("person-e")
    pg.click("#tabPlaza")
    pg.wait_for_timeout(1200)
    print("7 plaza for someone new after 3 reports:", pg.inner_text("#plazaSummary"))
    as_person("person-a")
    pg.click("#routesList li:has-text('Long walk') button")
    print("8 owner still sees it:", "Hidden after several reports" in pg.inner_text("#nodesList"))

    # ── Link an email ──
    print("9 account:", pg.inner_text("#accountStatus"))
    pg.fill("#linkEmail", "parrot@example.com")
    pg.click("#linkForm button")
    pg.wait_for_timeout(600)
    print("  after sending:", pg.inner_text("#accountMsg")[:70], "| code box hidden:", not visible("#otpForm"), "| 'Have a code?' shown:", visible("#haveCodeBtn"))
    pg.click("#haveCodeBtn")
    pg.fill("#otpInput", "000000")
    pg.click("#otpForm button")
    pg.wait_for_timeout(600)
    print("  wrong code:", pg.inner_text("#accountMsg"))
    pg.fill("#otpInput", "123456")
    pg.click("#otpForm button")
    pg.wait_for_timeout(800)
    print("  right code:", pg.inner_text("#accountMsg"), "|", pg.inner_text("#accountStatus")[:40], "| sign out shown:", visible("#accountLinked"))
    print("page errors:", errors)
    b.close()
