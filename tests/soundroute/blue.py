"""Shared helpers for the SoundRoute browser tests (Blue interface).

The real Supabase client (cdn.jsdelivr.net) is replaced by fake-supabase.js,
which keeps its data in localStorage. GPS, microphone and compass are
simulated. Each test prints one line per check and exits non-zero if any
check failed.
"""
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = open(os.path.join(HERE, "fake-supabase.js")).read()
BASE = "http://localhost:8765/index.html"
START = (51.48650, -0.12350)
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

failures = []


def check(label, ok, detail=""):
    mark = "ok  " if ok else "FAIL"
    print(f"{mark} {label}{(' — ' + str(detail)) if detail != '' else ''}")
    if not ok:
        failures.append(label)


def finish(errors):
    check("no page errors", not errors, errors[:3] if errors else "")
    if failures:
        print(f"\n{len(failures)} check(s) failed:", failures)
        sys.exit(1)
    print("\nall checks passed")


class App:
    def __init__(self, p, guide_seen=True, user_agent=None):
        self.browser = p.chromium.launch(
            args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
        )
        opts = dict(
            viewport={"width": 390, "height": 844},
            geolocation={"latitude": START[0], "longitude": START[1], "accuracy": 8},
            permissions=["geolocation", "microphone", "accelerometer", "gyroscope", "magnetometer", "clipboard-read", "clipboard-write"],
        )
        if user_agent:
            opts["user_agent"] = user_agent
        self.ctx = self.browser.new_context(**opts)
        if guide_seen:
            self.ctx.add_init_script("try { localStorage.setItem('soundroute-guide','seen'); } catch (e) {}")
        self.ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=FAKE))
        self.ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        self.pg = self.ctx.new_page()
        self.here = {"latitude": START[0], "longitude": START[1], "accuracy": 8}
        self.errors = []
        self.pg.on("pageerror", lambda e: self.errors.append(str(e)))

    # ── reading the page ──
    def visible(self, sel):
        return self.pg.locator(sel).first.is_visible()

    def text(self, sel):
        return self.pg.inner_text(sel).strip()

    def screen(self):
        return self.pg.evaluate(
            "[...document.querySelectorAll('.screen')].filter(s=>!s.hidden && !s.classList.contains('leave-push') && !s.classList.contains('leave-pop') && !s.classList.contains('leave-fade')).map(s=>s.id.slice(2)).pop()"
        )

    def wait_screen(self, name, ms=15000):
        self.pg.wait_for_function(
            f"!document.getElementById('s-{name}').hidden && !document.getElementById('s-{name}').className.includes('leave-')",
            timeout=ms,
        )
        self.pg.wait_for_timeout(400)

    def log(self):
        return self.pg.evaluate("document.getElementById('debugLogPre').textContent")

    def db(self):
        return self.pg.evaluate("JSON.parse(localStorage.getItem('fake-supabase-db') || '{}')")

    def toast(self):
        return self.text("#toastText") if self.visible("#toast") else ""

    def wait_toast(self, ms=4000):
        try:
            self.pg.wait_for_function("!document.getElementById('toast').hidden && document.getElementById('toastText').textContent", timeout=ms)
        except Exception:
            return ""
        return self.text("#toastText")

    def shot(self, name):
        self.pg.screenshot(path=os.path.join(OUT, f"{name}.png"))

    # ── doing things ──
    def goto(self):
        self.pg.goto(BASE)
        self.pg.wait_for_timeout(1500)

    def as_person(self, user_id):
        self.pg.evaluate(f"localStorage.setItem('fake-uid', '{user_id}')")
        self.pg.reload()
        self.pg.wait_for_timeout(2500)

    def tab(self, name):
        """Tap a tab in whichever navigation is showing."""
        sel = f".screen:not([hidden]) [data-tab-go={name}]"
        self.pg.locator(sel).first.click()
        self.pg.wait_for_timeout(500)

    def orient(self, heading=0):
        self.pg.evaluate(
            f"()=>{{const e=new Event('deviceorientation');Object.defineProperty(e,'webkitCompassHeading',{{value:{heading}}});Object.defineProperty(e,'alpha',{{value:0}});Object.defineProperty(e,'beta',{{value:80}});Object.defineProperty(e,'gamma',{{value:0}});window.dispatchEvent(e)}}"
        )

    def start_walk(self):
        """From anywhere: go to Journey and tap the start arrow."""
        if self.screen() not in ("intro", "home"):
            self.tab("journey")
            self.pg.wait_for_timeout(300)
        if self.screen() == "home":
            self.pg.click("#homeAgain")
        else:
            self.pg.click("#startBtn")
        self.pg.wait_for_timeout(500)
        if self.screen() == "perms":
            self.pg.click("#permsGo")
        # The simulated GPS only reports after a position is set: keep nudging it.
        for _ in range(30):
            if self.screen() == "walking":
                break
            self.ctx.set_geolocation(self.here)
            self.pg.wait_for_timeout(500)
        self.wait_screen("walking")

    def move(self, seconds, lat=START[0], lng=START[1], dlat=0.000012, heading=0, every=None):
        for i in range(seconds):
            lat += dlat
            self.here = {"latitude": lat, "longitude": lng, "accuracy": 8}
            self.ctx.set_geolocation(self.here)
            self.orient(heading)
            self.pg.wait_for_timeout(1000)
            if every:
                every(i)
        return lat

    def end_walk(self, name=None, save=True):
        self.pg.click("#endBtn")
        self.wait_screen("walk")
        self.pg.wait_for_timeout(1200)
        self.pg.click("#skipEnding")
        self.pg.wait_for_timeout(1500)
        if name:
            self.pg.click("#penBtn")
            self.pg.fill("#renameInput", name)
            self.pg.press("#renameInput", "Enter")
            self.pg.wait_for_timeout(400)
        if save:
            self.pg.click("#walkSave")
            self.wait_screen("home")

    def walk(self, name, seconds, lng=START[1], dlat=0.000012, expect_upload=True):
        self.here = {"latitude": START[0], "longitude": lng, "accuracy": 8}
        self.ctx.set_geolocation(self.here)
        self.pg.wait_for_timeout(300)
        self.start_walk()
        self.move(seconds, lng=lng, dlat=dlat)
        self.end_walk(name)
        if expect_upload:
            try:
                self.pg.wait_for_function("document.getElementById('homeStatus').hidden", timeout=8000)
            except Exception:
                pass

    def open_my_walk(self, name):
        self.tab("mymap")
        if self.visible("#segMine"):
            self.pg.click("#segMine")
        card = self.pg.locator(f"#myCards .card:has(.card-title:text-is('{name}'))")
        card.scroll_into_view_if_needed()
        card.locator(".card-open").click()
        self.wait_screen("walk")

    def tap_city_light(self, index=0):
        """Tap the middle of a light on the City map."""
        box = self.pg.locator("#cityMap .glow").nth(index).bounding_box()
        self.pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.pg.wait_for_timeout(1200)

    def close(self):
        self.browser.close()


def run(fn, **kw):
    with sync_playwright() as p:
        app = App(p, **kw)
        try:
            fn(app)
        except Exception as e:
            print("FAIL stopped:", str(e).split("\n")[0])
            try:
                print("  on screen:", app.screen())
                app.shot("failure")
                print("  log tail:\n" + "\n".join(app.log().split("\n")[-15:]))
            except Exception:
                pass
            failures.append("test stopped early")
        finally:
            errors = list(app.errors)
            app.close()
        finish(errors)
