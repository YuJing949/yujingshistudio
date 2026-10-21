// Listening decisions (soundtrack/listen.js). Run: node tests/soundroute/decide.test.mjs
import { decideListen, listenGain } from "../../soundtrack/listen.js";
import assert from "node:assert/strict";
// Walk A goes north along x=0 (y = 0..60, 3 m per 2 s); walk B goes north along x=12.
const line = (id, x0) => ({ id, name: id, nodes: Array.from({length: 21}, (_, i) => ({ x: x0, y: i * 3, t: i * 2 })) });
const A = line("A", 0), B = line("B", 12);
const base = { walks: [A, B], cooldowns: new Map(), nowMs: 0 };
let r;
r = decideListen({ ...base, x: 0, y: -30, heading: 0, current: null }); assert.equal(r.action, "none"); // too far
r = decideListen({ ...base, x: 0, y: -10, heading: 0, current: null }); assert.equal(r.action, "start"); assert.equal(r.walk.id, "A"); assert.equal(r.point.t, 0);
r = decideListen({ ...base, x: 0, y: -10, heading: 180, current: null }); assert.equal(r.action, "none"); // facing away
r = decideListen({ ...base, x: 1, y: 30, heading: 0, current: null }); assert.equal(r.walk.id, "A"); assert.equal(r.point.t, 20); // joins mid-walk
r = decideListen({ ...base, x: 1, y: 30, heading: 0, current: { walkId: "A", audioTime: 22 } }); assert.equal(r.action, "keep");
r = decideListen({ ...base, x: 1, y: 30, heading: 0, current: { walkId: "A", audioTime: 5 } }); assert.equal(r.action, "resync"); assert.equal(r.point.t, 20);
r = decideListen({ ...base, x: 6, y: 30, heading: 90, current: { walkId: "A", audioTime: 20 } }); assert.equal(r.action, "keep"); // in between: stays
r = decideListen({ ...base, x: 12, y: 30, heading: 0, current: { walkId: "A", audioTime: 20 } }); assert.equal(r.action, "switch"); assert.equal(r.walk.id, "B");
r = decideListen({ ...base, walks: [A], x: 40, y: 30, heading: 0, current: { walkId: "A", audioTime: 20 } }); assert.equal(r.action, "stop");
r = decideListen({ ...base, cooldowns: new Map([["A", 10000]]), x: 0, y: -10, heading: 0, current: null }); assert.notEqual(r.walk?.id, "A"); // A rests after it ended (B may start)
r = decideListen({ ...base, x: 0, y: -10, heading: NaN, current: null }); assert.equal(r.action, "start"); // no compass: still works
assert.equal(listenGain(2, 170), 1); assert.ok(listenGain(20, 0) < 0.5); assert.ok(listenGain(15, 170) < listenGain(15, 0));
console.log("all decision tests pass");
