"""End-to-end test: first-time guide, Home Screen help, private start,
reporting (three reports hide a walk), and linking an email.

Usage (from the repo root, server running as for run.py):
    python3 tests/soundroute/polish.py
The fake Supabase accepts the code 123456. Screenshots: out/guide-*.png,
report.png, account-*.png
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blue import START, check, run  # noqa: E402

IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"


def test(app):
    pg = app.pg

    # ── First visit: guide ──
    app.goto()
    check("guide on first visit", app.screen() == "guide")
    titles = []
    for i in range(4):
        titles.append(pg.evaluate("(() => { const t = document.querySelector('.guide-track'); const i = Math.round(t.scrollLeft / 390); return [...t.querySelectorAll('.gpage')].filter(p => !p.hidden)[i].querySelector('h1').innerText.replace(/\\s+/g, ' ') })()"))
        app.shot(f"guide-{i + 1}")
        if app.visible("#guideNext"):
            pg.click("#guideNext")
            pg.wait_for_timeout(700)
    check("four guide pages", titles == ["Hi, this is Parrot.", "Follow the sound", "Keep your walks", "Find something to hear"], titles)
    check("iPhone Safari gets the Share steps", "Tap Share" in pg.inner_text(".gpage[data-page='3']"))
    check("last page has no Next, three choices instead", not app.visible("#guideNext") and pg.locator(".choice").count() == 3)
    pg.click(".choice[data-go=city]")
    pg.wait_for_timeout(900)
    check("'Explore the City' closes the guide and opens City", app.screen() == "city")
    pg.reload()
    pg.wait_for_timeout(1500)
    check("guide not shown again", app.screen() == "intro", app.screen())

    # ── Home Screen help, manifest ──
    app.tab("mymap")
    pg.click("#accountBtn")
    app.wait_screen("account")
    pg.click("#homeScreenRow")
    app.wait_screen("guide")
    check("'Add to Home Screen' shows just that page", app.text(".gpage[data-page='3'] h1").replace("\n", " ") == "Keep your walks" and app.visible(".gpage[data-page='3'] h1") and not app.visible(".gpage[data-page='1'] h1") and app.visible("#guideBack") and not app.visible("#guideNext"))
    pg.click("#guideBack")
    app.wait_screen("account")
    check("and goes back to the account", app.screen() == "account")
    check("manifest loads", pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json()).then(j=>j.name)") == "SoundRoute")

    # ── Private start ──
    app.as_person("person-a")
    app.walk("Long walk", 30, dlat=0.00003)  # ~3.3 m a second, ~100 m
    db = app.db()
    route = db["routes"][0]
    pts = sorted([q for q in db["points"] if q["route_id"] == route["id"]], key=lambda q: q["t"])
    first_m = (pts[0]["lat"] - START[0]) * 111320
    check("first 30 m are not stored", first_m >= 25, f"{round(first_m)} m")
    app.open_my_walk("Long walk")
    pg.click("#publicSwitch")
    pg.wait_for_timeout(600)

    # ── Three reports hide it ──
    app.here = {"latitude": START[0], "longitude": START[1], "accuracy": 8}
    app.ctx.set_geolocation(app.here)
    for i, person in enumerate(["person-b", "person-c", "person-d"]):
        app.as_person(person)
        app.tab("city")
        pg.wait_for_timeout(1500)
        app.tap_city_light()
        pg.locator("#areaCards .card-open").first.click()
        app.wait_screen("walk")
        pg.click("#walkCorner")  # Report
        pg.wait_for_timeout(600)
        if i == 0:
            check("report sheet: Send is off until a reason is chosen", app.visible("#reportSheet") and pg.is_disabled("#reportSend"))
        pg.click("#reportSheet label:has-text('Spam, or not really a walk')")
        if i == 0:
            app.shot("report")
        pg.click("#reportSend")
        t = app.wait_toast()
        check(f"{person} reported", t == "Report sent. We’ll review it." and app.visible("#walkReported"), t)
    app.as_person("person-e")
    app.tab("city")
    pg.wait_for_timeout(1500)
    check("hidden from someone new after 3 reports", app.text("#citySummary") == "0 walks nearby", app.text("#citySummary"))
    app.as_person("person-a")
    app.tab("mymap")
    check("owner sees 'Hidden for review'", "Hidden for review" in app.text("#myCards"), app.text("#myCards").replace("\n", " | "))

    # ── Link an email ──
    pg.click("#accountBtn")
    app.wait_screen("account")
    check("account starts anonymous", app.text("#accAnonTitle") == "Anonymous on this phone")
    pg.fill("#emailInput", "not-an-email")
    pg.click("#emailSubmit")
    check("bad address is flagged", app.visible("#emailError"))
    pg.fill("#emailInput", "parrot@example.com")
    pg.click("#emailSubmit")
    pg.wait_for_timeout(700)
    check("after sending: check your email + resend timer", app.visible("#accSent") and "parrot@example.com" in app.text("#sentNote") and "resend in 0:" in app.text("#accResend"))
    app.shot("account-sent")
    pg.fill("#otpInput", "000000")
    pg.wait_for_timeout(700)
    check("wrong code: message", app.visible("#otpError"))
    pg.fill("#otpInput", "123456")
    t = app.wait_toast()
    check("right code links the email", t == "Email linked" and app.text("#linkedTitle") == "Linked to parrot@example.com", t)
    app.shot("account-linked")
    pg.click("#signOutBtn")
    pg.wait_for_timeout(500)
    check("sign out asks first", app.text("#dialogTitle") == "Sign out?")
    pg.click("#dialogNo")


run(test, guide_seen=False, user_agent=IPHONE)
