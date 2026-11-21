// MIHRAB server – no dependencies, needs only Node.js (v18+)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const PORT=+process.env.PORT||3000,DIR=__dirname,FILE=path.join(DIR,process.env.DATA||'data.json');
const hash=(p,s)=>{s=s||crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(String(p),s,32).toString('hex')};
const ok=(p,h)=>{if(!h)return false;const[s,x]=h.split(':');return crypto.timingSafeEqual(Buffer.from(hash(p,s).split(':')[1],'hex'),Buffer.from(x,'hex'))};
const seed=()=>({users:[{u:'admin',h:hash('admin123'),role:'admin'},{u:'hr',h:hash('hr123'),role:'hr'}],teachers:[],students:[],subjects:['Quran','Arabic Language','Islamic Studies'],slots:[],lessons:[],pay:{},audit:[],shared:{},n:{t:1,s:1,sl:1,l:1}});
let D=fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE,'utf8')):seed();D.cancels=D.cancels||[];D.reminders=D.reminders||[];D.settings=D.settings||{pay:''};
const persist=()=>{fs.writeFileSync(FILE+'.tmp',JSON.stringify(D));fs.renameSync(FILE+'.tmp',FILE)};
const backup=()=>{try{fs.mkdirSync(path.join(DIR,'backups'),{recursive:true});fs.copyFileSync(FILE,path.join(DIR,'backups','data-'+new Date().toISOString().slice(0,10)+'.json'))}catch(e){}};
persist();backup();setInterval(backup,6*36e5);
const strip=(o,...k)=>{const r={...o};k.forEach(x=>delete r[x]);return r};
const toMin=t=>{const[h,m]=t.split(':').map(Number);const x=h*60+m;return x<720?x+1440:x};
function view(s){const base={subjects:D.subjects,n:D.n};
 if(s.role=='admin')return{...D,waAuto:auto(),users:D.users.map(u=>strip(u,'h'))};
 if(s.role=='hr')return{...base,teachers:D.teachers.map(t=>strip(t,'rate')),students:D.students.map(x=>strip(x,'rate')),slots:D.slots,lessons:D.lessons.map(l=>strip(l,'tr','sr')),cancels:D.cancels,reminders:D.reminders.slice(0,50),waAuto:auto(),users:[],pay:{},audit:[],shared:{}};
 const slots=D.slots.filter(x=>x.tid==s.tid),lessons=D.lessons.filter(l=>l.tid==s.tid).map(l=>strip(l,'sr')),ids=new Set([...slots.map(x=>x.sid),...lessons.map(l=>l.sid)]),re=new RegExp('^t'+s.tid+'(\\d{4}-\\d{2})?$');
 return{...base,teachers:D.teachers.filter(t=>t.id==s.tid),students:D.students.filter(x=>ids.has(x.id)).map(x=>strip(x,'rate','phone')),slots,lessons,cancels:D.cancels.filter(k=>slots.some(x=>x.id==k.slot)),users:[],pay:{},audit:[],shared:Object.fromEntries(Object.entries(D.shared||{}).filter(([k])=>re.test(k)))}}
function merge(s,c,restore){
 if(!c||['teachers','students','slots','lessons'].some(k=>!Array.isArray(c[k])))return'Invalid data';
 const aud=()=>{const seen=new Set(D.audit.map(a=>a.t+a.by+a.m));[...(c.audit||[])].reverse().forEach(a=>{if(a&&!seen.has(a.t+a.by+a.m))D.audit.unshift({t:String(a.t),by:s.u,m:String(a.m).slice(0,300)})});D.audit=D.audit.slice(0,500)};
 if(s.role=='admin'){
  const us=(c.users||[]).map(x=>{const o=D.users.find(y=>y.u==x.u);return{u:String(x.u),role:x.role,tid:x.tid,h:x.p?hash(x.p):o?o.h:hash('ChangeMe123')}});
  if(!us.some(u=>u.role=='admin')||us.some(u=>!['admin','hr','teacher'].includes(u.role)))return'At least one admin is required';
  if(restore)D.lessons=c.lessons;else{const m=new Map(D.lessons.map(l=>[l.id,l]));c.lessons.forEach(l=>m.set(l.id,l));D.lessons=[...m.values()]}
  D.users=us;D.teachers=c.teachers.map(t=>({...t,photo:typeof t.photo=='string'&&t.photo.startsWith('data:image/')&&t.photo.length<150000?t.photo:'',edu:String(t.edu||'').slice(0,200),payMethod:String(t.payMethod||'').slice(0,200)}));D.students=c.students.map(cleanS);D.subjects=c.subjects;D.slots=c.slots;D.pay=c.pay||{};D.shared=c.shared||{};aud();
 }else if(s.role=='hr'){
  D.slots=c.slots;D.students=c.students.map(x=>{const o=D.students.find(y=>y.id==x.id);return{...cleanS(x),rate:o?o.rate:0}});
  c.teachers.forEach(t=>{const o=D.teachers.find(y=>y.id==t.id);if(!o)return;if(String(t.name||'').trim())o.name=String(t.name).trim().slice(0,100);o.payMethod=String(t.payMethod||'').slice(0,200);if(t.left&&!o.left){o.left=true;D.users=D.users.filter(u=>u.tid!=o.id)}});aud();
 }else{
  const add=[],now=new Date();
  for(const l of c.lessons.filter(l=>l.isNew&&l.tid==s.tid)){
   const sl=D.slots.find(x=>x.id==l.slot&&x.tid==s.tid);if(!sl)return'Lesson not scheduled for you';if(D.cancels.some(k=>k.slot==l.slot&&k.date==l.date))return'This lesson was cancelled by the academy.';if(paused(D.students.find(z=>z.id==sl.sid),l.date))return'This student is on a break for that date.';
   if(![...D.lessons,...add].some(x=>x.slot==l.slot&&x.date==l.date&&x.status!='rejected')===false)return'This lesson is already registered for that date.';
   const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(l.date||'');if(!m||!(+l.dur>=5&&+l.dur<=300))return'Invalid lesson data';
   if(new Date(+m[1],+m[2]-1,+m[3],0,toMin(sl.start)+sl.dur)>now)return'You can only register a lesson after it ends.';
   add.push({id:D.n.l++,tid:s.tid,sid:sl.sid,slot:sl.id,sub:sl.sub,date:l.date,dur:+l.dur,hw:String(l.hw||'').slice(0,300),advice:String(l.advice||'').slice(0,300),att:l.att=='absent'?'absent':'present',rating:l.att=='absent'?0:Math.min(5,Math.max(1,+l.rating||5)),status:'approved',tr:(D.teachers.find(x=>x.id==s.tid)||{}).rate||0,sr:(D.students.find(x=>x.id==sl.sid)||{}).rate||0});
  }
  D.lessons.push(...add);
 }
 if(s.role!='teacher'&&Array.isArray(c.cancels))D.cancels=c.cancels.filter(k=>k&&Number.isFinite(+k.slot)&&/^\d{4}-\d{2}-\d{2}$/.test(k.date)).map(k=>({slot:+k.slot,date:k.date,by:s.u}));
 if(s.role=='hr')c.lessons.forEach(l=>{const o=D.lessons.find(x=>x.id==l.id);if(o)o.sent=!!l.sent});
 D.students.forEach(x=>{if(x.phone!=null)x.phone=String(x.phone).replace(/[^0-9]/g,'').slice(0,15)});
 if(s.role!='teacher')(c.reminders||[]).forEach(r=>{const o=D.reminders.find(x=>x.key==r.key);if(o&&o.status=='due'&&r.status=='sent')o.status='sent'});
 if(s.role=='admin'&&c.settings&&typeof c.settings=='object')D.settings={pay:String(c.settings.pay||'').slice(0,300)};
 for(const k in D.n)D.n[k]=Math.max(D.n[k],(c.n&&c.n[k])||0);
 return null}

const dOK=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||''),okPause=p=>p&&dOK(p.from)?{from:p.from,to:dOK(p.to)?p.to:''}:undefined,paused=(s,ds)=>!!(s&&s.pause&&s.pause.from&&ds>=s.pause.from&&(!s.pause.to||ds<=s.pause.to)),cleanS=x=>({...x,name:String(x.name||'').trim().slice(0,100)||'?',payMethod:String(x.payMethod||'').slice(0,200),pause:okPause(x.pause)});
// ---- WhatsApp reminders (30 min before each lesson) ----
const WA_API=process.env.WA_API||'https://graph.facebook.com/v20.0',NOW=()=>process.env.MIHRAB_TEST_NOW?new Date(process.env.MIHRAB_TEST_NOW):new Date();
const readWA=()=>{try{return JSON.parse(fs.readFileSync(path.join(DIR,'whatsapp.json'),'utf8'))}catch(e){return{}}};
const auto=()=>{const W=readWA();return!!(W.token&&W.phoneId)};
const ymdS=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),DNs=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const hm12=x=>{x%=1440;const h=Math.floor(x/60);return(h%12||12)+':'+String(x%60).padStart(2,'0')+' '+(h<12?'AM':'PM')};
async function sendWA(W,to,params){const r=await fetch(WA_API+'/'+W.phoneId+'/messages',{method:'POST',headers:{Authorization:'Bearer '+W.token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:W.reminderTemplate||'class_reminder',language:{code:W.language||'en'},components:[{type:'body',parameters:params.map(p=>({type:'text',text:String(p)}))}]}})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error((j.error&&j.error.message)||('HTTP '+r.status));return j}
function tick(){const W=readWA(),on=!!(W.token&&W.phoneId),min=+W.minutesBefore||30,now=NOW();let ch=false;
 for(let i=-1;i<=1;i++){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i),ds=ymdS(d);
  D.slots.filter(x=>x.day==DNs[d.getDay()]&&(!x.since||ds>=x.since)).forEach(x=>{
   const st=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,toMin(x.start)),key=x.id+'|'+ds;
   if(now<new Date(st-min*6e4)||now>=st||D.reminders.some(r=>r.key==key)||D.cancels.some(k=>k.slot==x.id&&k.date==ds))return;
   const s=D.students.find(z=>z.id==x.sid),t=D.teachers.find(z=>z.id==x.tid);if(!s||s.left||!t||t.left||paused(s,ds))return;
   const time=hm12(toMin(x.start)),r={key,slot:x.id,sid:x.sid,date:ds,student:s.name,sub:x.sub,teacher:t.name,time,at:now.toISOString(),status:s.phone?'due':'nophone',text:`Assalamu alaikum! A friendly reminder from MIHRAB Educational Institute: ${s.name}'s ${x.sub} lesson with ${t.name} starts today at ${time} (in about ${min} minutes). Jazakum Allahu khairan.`};
   D.reminders.unshift(r);ch=true;
   if(on&&s.phone)sendWA(W,s.phone,[s.name,x.sub,t.name,time]).then(()=>{r.status='sent'}).catch(e=>{r.status='failed';r.error=String(e.message).slice(0,200)}).finally(persist)})}
 if(D.reminders.length>300)D.reminders.length=300;if(ch)persist()}
setInterval(tick,+process.env.TICK_MS||30000);tick();
const S=new Map(),send=(res,code,o)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
http.createServer((req,res)=>{
 if(req.method=='GET'&&(req.url=='/'||req.url=='/index.html'))return fs.readFile(path.join(DIR,'public','index.html'),(e,b)=>{res.writeHead(e?500:200,{'Content-Type':'text/html; charset=utf-8'});res.end(e?'Missing public/index.html':b)});
 if(!req.url.startsWith('/api/'))return send(res,404,{error:'Not found'});
 let body='';req.on('data',c=>{body+=c;if(body.length>60e6)req.destroy()});
 req.on('end',()=>{let j={};try{j=body?JSON.parse(body):{}}catch(e){return send(res,400,{error:'Bad JSON'})}
  if(req.url=='/api/login'&&req.method=='POST'){const u=D.users.find(x=>x.u==j.u);if(!u||!ok(j.p,u.h))return setTimeout(()=>send(res,401,{error:'Invalid'}),600);const token=crypto.randomBytes(24).toString('hex'),s={u:u.u,role:u.role,tid:u.tid,exp:Date.now()+12*36e5};S.set(token,s);return send(res,200,{token,u:s.u,role:s.role,tid:s.tid,db:view(s)})}
  const s=S.get((req.headers.authorization||'').slice(7));if(!s||s.exp<Date.now()||!D.users.some(x=>x.u==s.u))return send(res,401,{error:'Session expired'});
  if(req.url=='/api/db'&&req.method=='GET')return send(res,200,view(s));
  if(req.url=='/api/db'&&req.method=='PUT'){const e=merge(s,j,req.headers['x-restore']=='1'&&s.role=='admin');if(e)return send(res,400,{error:e});persist();return send(res,200,view(s))}
  if(req.url=='/api/password'&&req.method=='POST'){const u=D.users.find(x=>x.u==s.u);if(!ok(j.old,u.h)||String(j.new||'').length<6)return send(res,400,{error:'Invalid'});u.h=hash(j.new);persist();return send(res,200,{ok:1})}
  send(res,404,{error:'Not found'})})
}).listen(PORT,'0.0.0.0',()=>{console.log('\nMIHRAB is running.\n  On this PC:   http://localhost:'+PORT);Object.values(os.networkInterfaces()).flat().filter(i=>i.family=='IPv4'&&!i.internal).forEach(i=>console.log('  Other PCs:    http://'+i.address+':'+PORT));console.log('\nKeep this window open. Press Ctrl+C to stop.\n')});
