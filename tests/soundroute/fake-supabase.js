// In-browser stand-in for supabase-js, persisted in localStorage (test only).
const KEY = "fake-supabase-db";
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"routes":[],"points":[],"files":{}}');
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const words = ["misty","quiet","amber"]; const nouns=["parrot","lamp","gate"];
const uid = () => { let u = localStorage.getItem("fake-uid"); if (!u) { u = crypto.randomUUID(); localStorage.setItem("fake-uid", u);} return u; };
class Q {
  constructor(t){ this.t=t; this.op="select"; this.filters=[]; }
  select(cols, opts){ if(this.op==="select"){this.cols=cols; this.opts=opts||{};} else this.ret=cols; return this; }
  upsert(row){ this.op="upsert"; this.row=row; return this; }
  update(o){ this.op="update"; this.row=o; return this; }
  delete(){ this.op="delete"; return this; }
  insert(rows){ this.op="insert"; this.rows=rows; return this; }
  eq(c,v){ this.filters.push(r=>r[c]===v); return this; }
  not(c,op,v){ this.filters.push(r=>r[c]!=null); return this; }
  order(){ return this; }
  single(){ this.one=true; return this; }
  then(res,rej){ try { res(this.run()); } catch(e){ rej(e); } }
  run(){
    const db=load(); const tbl=db[this.t]; const match=r=>this.filters.every(f=>f(r));
    if(this.op==="upsert"){ let r=tbl.find(x=>x.id===this.row.id); if(!r){ r={owner:uid(),is_public:false,share_code:`${words[tbl.length%3]}-${nouns[tbl.length%3]}-0${tbl.length}42`,created_at:new Date().toISOString(),audio_path:null,...this.row}; tbl.push(r);} else Object.assign(r,this.row); save(db); return {data:this.one?r:[r],error:null}; }
    if(this.op==="update"){ tbl.filter(match).forEach(r=>Object.assign(r,this.row)); save(db); return {error:null}; }
    if(this.op==="delete"){ db[this.t]=tbl.filter(r=>!match(r)); if(this.t==="routes"){ const ids=new Set(db.routes.map(r=>r.id)); db.points=db.points.filter(p=>ids.has(p.route_id)); } save(db); return {error:null}; }
    if(this.op==="insert"){ tbl.push(...this.rows); save(db); return {error:null}; }
    const rows=tbl.filter(match);
    if(this.opts?.head) return {count:rows.length,error:null};
    if(this.t==="routes" && this.cols.includes("points(")) return {data:rows.map(r=>({...r,points:db.points.filter(p=>p.route_id===r.id).sort((a,b)=>a.t-b.t)})),error:null};
    return {data:rows,error:null};
  }
}
const toDataUrl=(blob)=>new Promise(r=>{const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(blob);});
export function createClient(){ return {
  auth:{ getSession: async()=>({data:{session:localStorage.getItem("fake-uid")?{user:{id:uid(),is_anonymous:true}}:null},error:null}),
         signInAnonymously: async()=>({data:{user:{id:uid(),is_anonymous:true}},error:null}) },
  from:(t)=>new Q(t),
  storage:{ from:()=>({
    upload: async(path,blob)=>{ if(localStorage.getItem("fake-fail-upload")) return {error:{message:"Network request failed"}}; const db=load(); db.files[path]=await toDataUrl(blob); save(db); window.__uploads=(window.__uploads||0)+1; return {error:null}; },
    remove: async(paths)=>{ const db=load(); paths.forEach(p=>delete db.files[p]); save(db); return {error:null}; },
    createSignedUrls: async(paths)=>{ const db=load(); return {data:paths.map(p=>({path:p,signedUrl:db.files[p]||null})),error:null}; },
  })},
};}
