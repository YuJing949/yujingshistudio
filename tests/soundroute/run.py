"""End-to-end test: record → save → reload → listen → offline retry → delete.

Usage (from the repo root):
    pip install playwright && playwright install chromium
    (cd soundtrack && python3 -m http.server 8765) &
    python3 tests/soundroute/run.py

Screenshots: tests/soundroute/out/ (walking.png, mine.png, home.png, mymap.png)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blue import START, check, run  # noqa: E402


def test(app):
    pg = app.pg
    app.goto()
    check("opens on Journey (guide already seen)", app.screen() == "intro", app.screen())
    pg.wait_for_timeout(1000)
    check("cloud connected", "[cloud] signed in" in app.log())

    # ── Too short to keep ──
    app.start_walk()
    check("first walk asks for permissions, then records", app.screen() == "walking")
    app.move(3)
    pg.click("#endBtn")
    pg.wait_for_timeout(600)
    check("a 3-second walk asks 'Too short to keep'", app.visible("#dialog") and "Too short" in app.text("#dialogTitle"))
    pg.click("#dialogNo")  # Keep walking
    pg.wait_for_timeout(500)
    check("'Keep walking' carries on recording", app.screen() == "walking" and not app.visible("#dialog"))

    # ── Walk A ──
    app.move(12)
    arc = pg.get_attribute("#micArc", "stroke-dasharray")
    check("orange progress arc grows", float(arc.split()[0]) > 5, arc)
    pg.click("#micBtn")
    pg.wait_for_timeout(300)
    check("mic button pauses", pg.get_attribute("#micBtn", "aria-pressed") == "false")
    pg.click("#micBtn")
    app.shot("walking")
    app.end_walk("Test walk A", save=False)
    check("Ending leads to the new walk's details", app.screen() == "walk" and app.text("#walkTitleBtn") == "Test walk A")
    check("new walk shows Discard and Save", app.text("#walkCorner") == "Discard" and app.visible("#walkSave"))
    check("route drawn in the orb", pg.locator("#walkRoute path").count() >= 1)
    app.shot("mine")
    pg.click("#walkSave")
    app.wait_screen("home")
    pg.wait_for_timeout(1500)
    check("Save goes to Home with the walk's name", app.text("#homeTitle") == "Test walk A")
    db = app.db()
    rows = [(r["name"], r["share_code"], r["duration_s"]) for r in db.get("routes", [])]
    check("walk A uploaded", len(rows) == 1 and rows[0][0] == "Test walk A", rows)
    check("points and audio uploaded", len(db.get("points", [])) > 3 and len(db.get("files", {})) == 1, (len(db.get("points", [])), len(db.get("files", {}))))
    app.shot("home")

    # ── Reload: still there ──
    pg.reload()
    pg.wait_for_timeout(2500)
    app.tab("mymap")
    pg.wait_for_timeout(800)
    check("after reload, My map lists walk A", "Test walk A" in app.text("#myCards") and app.text("#segMine") == "Mine 1", app.text("#mymapSummary"))
    app.shot("mymap")

    # ── Walk B from the same start: hears walk A ──
    app.walk("Test walk B", 10)
    events = [l[15:] for l in app.log().split("\n") if "[listen] start" in l or "[listen] switch" in l]
    check("walking near walk A plays it", any("Test walk A" in e for e in events), events[:3])

    # ── Offline walk C, retried after reload ──
    pg.evaluate("localStorage.setItem('fake-fail-upload','1')")
    app.walk("Offline walk C", 12, expect_upload=False)
    pg.wait_for_timeout(1500)
    check("failed upload says so on Home", "Not uploaded yet" in app.text("#homeStatus"), app.text("#homeStatus"))
    pg.evaluate("localStorage.removeItem('fake-fail-upload')")
    pg.reload()
    pg.wait_for_timeout(4000)
    names = [r["name"] for r in app.db()["routes"]]
    check("after reload the waiting walk uploads", "Offline walk C" in names, names)

    # ── Delete walk A ──
    files_before = len(app.db()["files"])
    app.open_my_walk("Test walk A")
    check("My walk shows the share code", app.visible("#shareCode") and "-" in app.text("#shareCode"), app.text("#shareCode"))
    pg.click("#walkCorner")  # Delete
    pg.wait_for_timeout(600)
    check("delete asks first", "Delete this walk?" in app.text("#dialogTitle"))
    pg.click("#dialogYes")
    toast = app.wait_toast()
    db = app.db()
    check("walk deleted", toast == "Walk deleted" and "Test walk A" not in [r["name"] for r in db["routes"]], toast)
    check("its audio file deleted", len(db["files"]) == files_before - 1)


run(test)
