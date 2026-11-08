"""Start over: the account page deletes everything and opens the guide again.

Usage (from the repo root, with the server from run.py running):
    python3 tests/soundroute/startover.py

Screenshots: tests/soundroute/out/ (startover-account.png, startover-dialog.png, startover-clearing.png)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blue import check, run  # noqa: E402


def open_account(app):
    app.tab("mymap")
    app.pg.click("#accountBtn")
    app.wait_screen("account")


def test(app):
    pg = app.pg
    app.goto()
    # Seen the guide once, the way a returning visitor has.
    pg.evaluate("localStorage.setItem('soundroute-guide', 'seen')")
    app.as_person("person-a")
    check("opens on Journey", app.screen() == "intro", app.screen())

    app.walk("Bridge hum", 12)
    me = pg.evaluate("localStorage.getItem('fake-uid')")
    mine = [r for r in app.db()["routes"] if r["owner"] == me]
    check("one walk uploaded", len(mine) == 1, len(mine))
    # Someone else saved it.
    pg.evaluate(
        f"""() => {{ const db = JSON.parse(localStorage.getItem('fake-supabase-db'));
        db.saves.push({{ user_id: 'person-z', route_id: '{mine[0]["id"]}', created_at: new Date().toISOString() }});
        localStorage.setItem('fake-supabase-db', JSON.stringify(db)); }}"""
    )

    open_account(app)
    check("account shows Start over", app.visible("#startOverRow"))
    app.shot("startover-account")

    # Keep: nothing happens
    pg.click("#startOverRow")
    pg.wait_for_selector("#dialog:not([hidden])")
    pg.wait_for_timeout(500)
    text = app.text("#dialogText")
    check("dialog counts the walk", "deletes your 1 walk" in text, text)
    check("dialog names the person who saved it", "1 person who saved your walks" in text, text)
    check("dialog says it can't be undone", "can’t be undone" in app.text("#dialogNote"))
    app.shot("startover-dialog")
    pg.click("#dialogNo")
    pg.wait_for_timeout(500)
    check("Keep leaves the walk", any(r["owner"] == me for r in app.db()["routes"]))

    # Fails before anything is deleted
    pg.evaluate("localStorage.setItem('fake-fail-remove', '1')")
    pg.click("#startOverRow")
    pg.wait_for_selector("#dialog:not([hidden])")
    pg.wait_for_timeout(400)
    pg.click("#dialogYes")
    toast = app.wait_toast(6000)
    check("a failure says nothing was deleted", "Nothing was deleted" in toast, toast)
    pg.wait_for_timeout(600)
    check("and goes back to the account", app.screen() == "account", app.screen())
    check("the walk is still there", any(r["owner"] == me for r in app.db()["routes"]))
    pg.evaluate("localStorage.removeItem('fake-fail-remove')")

    # Start over for real
    pg.click("#startOverRow")
    pg.wait_for_selector("#dialog:not([hidden])")
    pg.wait_for_timeout(400)
    pg.click("#dialogYes")
    app.wait_screen("startover", 5000)
    app.shot("startover-clearing")
    pg.wait_for_function("document.getElementById('s-guide') && !document.getElementById('s-guide').hidden", timeout=15000)
    pg.wait_for_timeout(1500)
    check("opens the guide again", app.screen() == "guide", app.screen())
    db = app.db()
    check("my walks are gone", not any(r["owner"] == me for r in db["routes"]))
    check("saves of my walk are gone", not any(s["route_id"] == mine[0]["id"] for s in db["saves"]))
    check("my audio is gone", not any(p.startswith(f"{me}/") for p in db["files"]))
    new_me = pg.evaluate("localStorage.getItem('fake-uid')")
    check("a new visitor", new_me and new_me != me, new_me)
    pending = pg.evaluate(
        """() => new Promise((res) => { const r = indexedDB.open('soundroute', 1);
        r.onsuccess = () => { const q = r.result.transaction('pendingWalks').objectStore('pendingWalks').count();
        q.onsuccess = () => res(q.result); }; })"""
    )
    check("no walks left on the phone", pending == 0, pending)


run(test, guide_seen=False)
