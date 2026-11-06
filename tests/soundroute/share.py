"""End-to-end test for sharing, two people: My map, City, codes, saving.

Usage (from the repo root, server running as for run.py):
    python3 tests/soundroute/share.py

Person A records two walks, renames one and makes it public, keeps the other
private. Person B finds the public walk in the City, previews it, saves it
from its details, adds the private one by share code, hears a saved walk
while walking, then removes one (with Undo). A deletes the public walk and it
disappears for B. Screenshots: out/city.png, area.png, found.png, saved.png
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blue import START, check, run  # noqa: E402


def test(app):
    pg = app.pg
    app.goto()
    app.as_person("person-a")

    # ── Person A ──
    app.walk("Canal walk", 12)
    app.walk("Secret garden", 12, lng=START[1] + 0.02)  # ~1.4 km east
    app.open_my_walk("Canal walk")
    pg.click("#penBtn")
    pg.fill("#renameInput", "Canal at dusk")
    pg.click("#walkCorner")  # Done
    pg.wait_for_timeout(600)
    check("rename from My walk", app.text("#walkTitleBtn") == "Canal at dusk")
    pg.click("#publicSwitch")
    pg.wait_for_timeout(600)
    check("public switch on", pg.get_attribute("#publicSwitch", "aria-checked") == "true" and app.text("#publicNote").startswith("On:"))
    db = app.db()
    row = next(r for r in db["routes"] if r["name"] == "Canal at dusk")
    check("rename and public saved in the cloud", row["is_public"] is True)
    pg.click("#walkBack")
    pg.wait_for_timeout(500)
    app.open_my_walk("Secret garden")
    secret_code = app.text("#shareCode")
    check("private walk has a share code", "-" in secret_code, secret_code)
    pg.click("#copyBtn")
    pg.wait_for_timeout(200)
    check("Copy says Copied", app.text("#copyBtn") == "Copied")

    # ── Person B (standing where A's first walk began) ──
    app.here = {"latitude": START[0], "longitude": START[1], "accuracy": 8}
    app.ctx.set_geolocation(app.here)
    app.as_person("person-b")
    app.tab("mymap")
    check("B starts with an empty My map", app.visible("#mymapEmpty"))
    app.tab("city")
    pg.wait_for_timeout(1500)
    check("City counts the public walk nearby", app.text("#citySummary") == "1 walk nearby", app.text("#citySummary"))
    check("a light is drawn", pg.locator("#cityMap .glow").count() == 1)
    app.shot("city")
    app.tap_city_light()
    check("tapping the light opens its walks", app.visible("#areaCount") and app.text("#areaCount") == "1 walk here", app.text("#areaCount") if app.visible("#areaCount") else "")
    check("card shows the walk", "Canal at dusk" in app.text("#areaCards"))
    check("its route is highlighted", pg.locator("#cityMap .route.is-selected").count() == 1)
    pg.locator("#areaCards .card-play").first.click()
    pg.wait_for_timeout(1500)
    check("play previews in place", pg.locator("#areaCards .card.is-playing").count() == 1 and app.screen() == "city")
    app.shot("area")
    pg.locator("#areaCards .card-open").first.click()
    app.wait_screen("walk")
    check("card opens the walk's details", app.text("#walkTitleBtn") == "Canal at dusk" and app.visible("#walkHeart") and app.text("#walkCorner") == "Report")
    check("someone else's walk shows a time of day, not a clock", any(w in app.text("#walkMeta") for w in ("Morning", "Afternoon", "Evening", "Night")), app.text("#walkMeta"))
    pg.click("#walkHeart")
    t = app.wait_toast()
    check("heart saves to My map", t == "Saved to My map" and pg.get_attribute("#walkHeart", "aria-pressed") == "true", t)
    pg.click("#walkBack")
    pg.wait_for_timeout(500)
    pg.click("#areaBack")
    pg.wait_for_timeout(400)

    # Codes
    pg.click("#addCodeBtn")
    pg.wait_for_timeout(500)
    check("Add code opens the sheet, link turns to Cancel", app.visible("#codeSheet") and app.text("#addCodeBtn") == "Cancel")
    pg.fill("#codeInput", "Nope Nope 0000")
    check("typing makes codes lower-case with dashes", pg.input_value("#codeInput") == "nope-nope-0000", pg.input_value("#codeInput"))
    pg.click("#codeAdd")
    pg.wait_for_timeout(900)
    check("wrong code: field marked, message shown", "is-wrong" in pg.get_attribute("#codeInput", "class") and app.text("#codeHint").startswith("No walk has this code"))
    pg.fill("#codeInput", secret_code)
    pg.click("#codeAdd")
    pg.wait_for_timeout(1500)
    check("right code shows the walk", app.visible("#foundCard") and app.text("#foundTitle") == "Secret garden")
    check("found card says it was shared privately", app.text("#foundMeta").startswith("Shared with you"), app.text("#foundMeta"))
    app.shot("found")
    pg.click("#foundSave")
    app.wait_screen("mymap")
    t = app.wait_toast()
    check("Save to My map goes to Saved", t == "Saved to My map" and pg.get_attribute("#segSaved", "aria-selected") == "true", t)
    check("Saved lists both walks", app.text("#segSaved") == "Saved 2" and "Secret garden" in app.text("#myCards"))
    app.shot("saved")

    # Hear a saved walk while walking
    app.walk("B's first walk", 12)
    events = [l[15:] for l in app.log().split("\n") if "[listen] start" in l or "[listen] switch" in l]
    check("B hears A's walk while walking", any("Canal at dusk" in e for e in events), events[:2])

    # Remove one, with Undo available
    app.tab("mymap")
    pg.click("#segSaved")
    pg.wait_for_timeout(400)
    card = pg.locator("#myCards .card:has(.card-title:text-is('Secret garden'))")
    card.scroll_into_view_if_needed()
    card.locator(".card-heart").click()
    t = app.wait_toast()
    check("removing offers Undo", t == "Removed from My map" and app.visible("#toastUndo"), t)
    pg.wait_for_timeout(800)
    pg.reload()
    pg.wait_for_timeout(2500)
    app.tab("mymap")
    pg.click("#segSaved")
    check("after reload one saved walk is left", app.text("#segSaved") == "Saved 1", app.text("#segSaved"))

    # ── A deletes the public walk: gone for B too ──
    app.as_person("person-a")
    app.open_my_walk("Canal at dusk")
    pg.click("#walkCorner")
    pg.wait_for_timeout(600)
    check("delete warns how many people saved it", "1 person who saved it" in app.text("#dialogText"), app.text("#dialogText"))
    pg.click("#dialogYes")
    app.wait_toast()
    app.as_person("person-b")
    app.tab("mymap")
    check("B's saved copy is gone", app.visible("#mymapEmpty") or app.text("#segSaved") == "Saved 0")
    app.tab("city")
    pg.wait_for_timeout(1500)
    check("City no longer shows it", app.text("#citySummary") == "0 walks nearby" and app.visible("#cityEmpty"), app.text("#citySummary"))


run(test)
