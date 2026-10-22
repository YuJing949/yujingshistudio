// In-browser stand-in for supabase-js, used only by tests/soundroute/run.py.
// Data lives in localStorage. Mimics the parts of supabase/soundroute.sql the
// app relies on: per-user visibility (row level security), share codes,
// save_by_code(), get_plaza_cells(), and the private audio bucket.
// Switch user in a test with: localStorage.setItem("fake-uid", "<id>").

const KEY = "fake-supabase-db";
const load = () => {
  const db = JSON.parse(localStorage.getItem(KEY) || "{}");
  return { routes: [], points: [], saves: [], reports: [], files: {}, ...db };
};
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const ADJ = ["misty", "quiet", "amber", "lost", "slow"];
const NOUN = ["parrot", "lamp", "gate", "bench", "river"];
const uid = () => {
  let u = localStorage.getItem("fake-uid");
  if (!u) {
    u = crypto.randomUUID();
    localStorage.setItem("fake-uid", u);
  }
  return u;
};

// Row level security, as in soundroute.sql
const canReadRoute = (db, r) =>
  r.owner === uid() ||
  (!r.hidden && (r.is_public || db.saves.some((s) => s.route_id === r.id && s.user_id === uid())));

class Query {
  constructor(table) {
    this.t = table;
    this.op = "select";
    this.filters = [];
    this.lim = Infinity;
  }
  select(cols, opts) {
    if (this.op === "select") {
      this.cols = cols || "*";
      this.opts = opts || {};
    }
    return this;
  }
  upsert(row) { this.op = "upsert"; this.row = row; return this; }
  update(o) { this.op = "update"; this.row = o; return this; }
  delete() { this.op = "delete"; return this; }
  insert(rows) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  not(c) { this.filters.push((r) => r[c] != null); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
  order() { return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = true; return this; }
  then(res, rej) {
    try {
      res(this.run());
    } catch (e) {
      rej(e);
    }
  }
  run() {
    const db = load();
    const me = uid();
    const match = (r) => this.filters.every((f) => f(r));

    if (this.t === "routes") {
      if (this.op === "upsert") {
        let r = db.routes.find((x) => x.id === this.row.id);
        if (!r) {
          const n = db.routes.length;
          r = { owner: me, is_public: false, share_code: `${ADJ[n % 5]}-${NOUN[n % 5]}-0${n}42`, created_at: new Date().toISOString(), audio_path: null, ...this.row };
          db.routes.push(r);
        } else if (r.owner === me) Object.assign(r, this.row);
        else return { data: null, error: { message: "permission denied" } };
        save(db);
        return { data: this.one ? r : [r], error: null };
      }
      if (this.op === "update") {
        db.routes.filter((r) => r.owner === me && match(r)).forEach((r) => Object.assign(r, this.row));
        save(db);
        return { error: null };
      }
      if (this.op === "delete") {
        const gone = new Set(db.routes.filter((r) => r.owner === me && match(r)).map((r) => r.id));
        db.routes = db.routes.filter((r) => !gone.has(r.id));
        db.points = db.points.filter((p) => !gone.has(p.route_id));
        db.saves = db.saves.filter((s) => !gone.has(s.route_id));
        save(db);
        return { error: null };
      }
      const rows = db.routes.filter((r) => canReadRoute(db, r) && match(r)).slice(0, this.lim);
      if (this.opts?.head) return { count: rows.length, error: null };
      const withPoints = this.cols.includes("points(");
      return {
        data: rows.map((r) => (withPoints ? { ...r, points: db.points.filter((p) => p.route_id === r.id) } : r)),
        error: null,
      };
    }

    if (this.t === "points") {
      const readable = (p) => db.routes.some((r) => r.id === p.route_id && canReadRoute(db, r));
      const owned = (p) => db.routes.some((r) => r.id === p.route_id && r.owner === me);
      if (this.op === "insert") {
        if (!this.rows.every(owned)) return { error: { message: "permission denied" } };
        db.points.push(...this.rows);
      } else if (this.op === "delete") {
        db.points = db.points.filter((p) => !(owned(p) && match(p)));
      } else {
        return { data: db.points.filter((p) => readable(p) && match(p)), error: null };
      }
      save(db);
      return { error: null };
    }

    if (this.t === "saves") {
      if (this.op === "insert") {
        for (const row of this.rows) {
          const r = db.routes.find((x) => x.id === row.route_id);
          if (!r || !r.is_public || row.user_id !== me) return { error: { message: "permission denied" } };
          if (db.saves.some((s) => s.user_id === me && s.route_id === row.route_id)) return { error: { code: "23505", message: "duplicate key" } };
          db.saves.push({ user_id: me, route_id: row.route_id, created_at: new Date().toISOString() });
        }
      } else if (this.op === "delete") {
        db.saves = db.saves.filter((s) => !(s.user_id === me && match(s)));
      } else {
        const rows = db.saves.filter((s) => s.user_id === me && match(s));
        return {
          data: rows.map((s) => {
            const r = db.routes.find((x) => x.id === s.route_id);
            return { ...s, routes: r ? { ...r, points: db.points.filter((p) => p.route_id === r.id) } : null };
          }),
          error: null,
        };
      }
      save(db);
      return { error: null };
    }
    if (this.t === "reports" && this.op === "insert") {
      for (const row of this.rows) {
        const r = db.routes.find((x) => x.id === row.route_id);
        if (!r || r.owner === me || !canReadRoute(db, r)) return { error: { message: "permission denied" } };
        if (db.reports.some((x) => x.route_id === r.id && x.reporter === me)) return { error: { code: "23505", message: "duplicate key" } };
        db.reports.push({ route_id: r.id, reporter: me, reason: row.reason });
        if (db.reports.filter((x) => x.route_id === r.id).length >= 3) r.hidden = true;
      }
      save(db);
      return { error: null };
    }
    throw new Error(`fake supabase: unknown table ${this.t}`);
  }
}

const toDataUrl = (blob) =>
  new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(blob);
  });

export function createClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: localStorage.getItem("fake-uid") ? { user: { id: uid(), is_anonymous: true } } : null },
        error: null,
      }),
      signInAnonymously: async () => ({ data: { user: { id: uid(), is_anonymous: true } }, error: null }),
      getUser: async () => {
        const email = localStorage.getItem("fake-email-" + uid());
        return { data: { user: { id: uid(), is_anonymous: !email, email } }, error: null };
      },
      updateUser: async ({ email }) => {
        localStorage.setItem("fake-pending-email", email);
        return { data: {}, error: null };
      },
      verifyOtp: async ({ email, token, type }) => {
        if (token !== "123456") return { error: { message: "Token has expired or is invalid" } };
        if (type === "email_change") localStorage.setItem("fake-email-" + uid(), email);
        return { data: {}, error: null };
      },
      signInWithOtp: async () => ({ data: {}, error: null }),
      signOut: async () => {
        localStorage.removeItem("fake-uid");
        return { error: null };
      },
    },
    from: (t) => new Query(t),
    rpc: async (fn, args) => {
      const db = load();
      if (fn === "save_by_code") {
        const r = db.routes.find((x) => x.share_code === String(args.code).trim().toLowerCase() && (!x.hidden || x.owner === uid()));
        if (!r) return { data: null, error: { message: "no walk with that code" } };
        if (!db.saves.some((s) => s.user_id === uid() && s.route_id === r.id)) {
          db.saves.push({ user_id: uid(), route_id: r.id, created_at: new Date().toISOString() });
          save(db);
        }
        return { data: r.id, error: null };
      }
      if (fn === "get_plaza_cells") {
        const cells = new Map();
        for (const r of db.routes.filter((x) => x.is_public && !x.hidden && x.center_lat != null)) {
          const lat = (Math.floor(r.center_lat / 0.0018) + 0.5) * 0.0018;
          const lng = (Math.floor(r.center_lng / 0.0029) + 0.5) * 0.0029;
          const k = `${lat},${lng}`;
          cells.set(k, { lat, lng, walks: (cells.get(k)?.walks || 0) + 1 });
        }
        return { data: [...cells.values()], error: null };
      }
      return { data: null, error: { message: `unknown function ${fn}` } };
    },
    storage: {
      from: () => ({
        upload: async (path, blob) => {
          if (localStorage.getItem("fake-fail-upload")) return { error: { message: "Network request failed" } };
          if (!path.startsWith(`${uid()}/`)) return { error: { message: "permission denied" } };
          const db = load();
          db.files[path] = await toDataUrl(blob);
          save(db);
          return { error: null };
        },
        remove: async (paths) => {
          const db = load();
          paths.filter((p) => p.startsWith(`${uid()}/`)).forEach((p) => delete db.files[p]);
          save(db);
          return { error: null };
        },
        createSignedUrls: async (paths) => {
          const db = load();
          const readable = (p) => db.routes.some((r) => r.audio_path === p && canReadRoute(db, r));
          return { data: paths.map((p) => ({ path: p, signedUrl: readable(p) ? db.files[p] || null : null })), error: null };
        },
      }),
    },
  };
}
