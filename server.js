'use strict';
// RubUp — сервер (Render + Neon Postgres). Единственная зависимость: pg.
const http=require('http'),fs=require('fs'),crypto=require('crypto'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch(e){}
const TOKEN=process.env.BOT_TOKEN||'',TGAPI=(process.env.API_BASE||'https://api.telegram.org').replace(/\/$/,''),
 PORT=+process.env.PORT||3000,
 ADMINS=(process.env.ADMIN_IDS||'').split(',').map(s=>+s.trim()).filter(Boolean),OWNER=ADMINS[0];
const BASE=(process.env.WEBAPP_URL||process.env.RENDER_EXTERNAL_URL||'').replace(/\/$/,''),
 HOOK='/tg/'+crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0,24);
if(!TOKEN||!process.env.DATABASE_URL){console.error('Нужны BOT_TOKEN и DATABASE_URL');process.exit(1)}

/* ---------- хранилище: Postgres (Neon), всё состояние одной JSON-строкой, запись раз в 1.5 с ---------- */
const {Pool}=require('pg');
const DB=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2});
let D={},dirty=0,saving=false;
async function load(){
 await DB.query('create table if not exists kv(k text primary key, v jsonb not null)');
 const r=await DB.query("select v from kv where k='main'");D=r.rows[0]?r.rows[0].v:{};
 D.users=D.users||{};D.promos=D.promos||{};D.wd=D.wd||[];D.paid=D.paid||{};D.pg=D.pg||{};D.day=D.day||{};D.tot=D.tot||{dep:0,wd:0,given:0,wag:0};}
async function save(){if(!dirty||saving)return;saving=true;dirty=0;
 try{await DB.query("insert into kv(k,v) values('main',$1) on conflict(k) do update set v=excluded.v",[JSON.stringify(D)])}catch(e){dirty=1;console.error('save',e.message)}saving=false}
setInterval(save,1500);
for(const sg of['SIGINT','SIGTERM'])process.on(sg,async()=>{dirty=1;while(saving)await new Promise(r=>setTimeout(r,50));await save();process.exit(0)});

const now=()=>Date.now(),dk=()=>new Date().toISOString().slice(0,10),
 rnd=()=>crypto.randomBytes(4).readUInt32BE()/4294967296,ri=n=>Math.floor(rnd()*n),E=m=>({error:m});
const mk=(b,m)=>({bal:b,wag:0,ups:0,wins:0,best:0,won:0,lost:0,wlAt:0,wdDay:0,wdDate:'',m,mines:null,ladder:null,crash:null,wp:null});
const isAdm=u=>u.id===OWNER||ADMINS.includes(u.id)||!!u.admin,isOwner=u=>u.id===OWNER;
function getUser(id,name){let u=D.users[id];if(!u){u=D.users[id]={id,name:name||'tg_'+id,main:mk(0,1),test:mk(100000,0),pu:[],admin:false,banned:false,banT:0,frozen:false,t0:now(),seen:now(),dep:0,wdn:0,games:0,d:{}};dirty=1}
 else if(name&&u.name!==name)u.name=name;return u}
const banned=u=>u.banned&&(!u.banT||u.banT>now());
const dayAdd=(k,v)=>{const d=D.day[dk()]=D.day[dk()]||{};d[k]=(d[k]||0)+v};

/* ---------- Telegram Bot API ---------- */
async function tg(method,body){try{const r=await fetch(`${TGAPI}/bot${TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return await r.json()}catch(e){return{ok:false,description:String(e.message)}}}
const say=(id,text,extra)=>tg('sendMessage',{chat_id:id,text,...extra});
function checkInit(init){ // проверка подписи Telegram Mini App; причина отказа в checkInit.why
 const bad=w=>{checkInit.why=w;return null};checkInit.why='';
 if(!init)return bad('нет данных входа');
 const p=new URLSearchParams(init),h=p.get('hash');if(!h)return bad('нет hash');p.delete('hash');
 const s=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n'),key=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest(),
  sig=crypto.createHmac('sha256',key).update(s).digest('hex');
 if(sig.length!==h.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(h)))return bad('подпись не совпала');
 if(now()/1000-(+p.get('auth_date')||0)>86400)return bad('вход устарел');
 try{return JSON.parse(p.get('user'))}catch(e){return bad('нет user')}}

/* ---------- игровая математика (та же, что в демо) ---------- */
const PM=[12,4,1.6,1.2,1.1,1.02,.2,1.02,1.1,1.2,1.6,4,12],WH=[5,100,10,50,15,500,20,25];
const CFG={wheel:WH.map(p=>({p})),wheel_min_wag:100,wd_limit:50000,up_edge:.9,up_top:.57,up_low:.01,up_min_x:1.58,up_max_x:90,mines_edge:.97,ladder_edge:.97,mines_win:null,max_bet:50000,ladder_rows:8,plinko:PM};
const left=a=>Math.max(0,Math.ceil((a.wlAt-now())/1000));
const chk=(a,b)=>!(b>=1)?E('Укажите ставку'):b>a.bal?E('Недостаточно звёзд'):b>50000?E('Макс. ставка 50 000 ★'):0;
function fin(a,g,bet,pay,win){a.wag+=bet;a.won+=pay;a.lost+=bet;if(win)a.wins++;a.best=Math.max(a.best,pay);
 if(a.m){D.pg[g]=(D.pg[g]||0)+bet-pay;D.tot.wag+=bet;dayAdd('wag',bet)}}
const pick=(n,k)=>{const x=[...Array(n).keys()];for(let i=n-1;i>0;i--){const j=ri(i+1);[x[i],x[j]]=[x[j],x[i]]}return x.slice(0,k)};
const mM=(n,m)=>{let r=.97;for(let i=0;i<n;i++)r*=(25-i)/(25-m-i);return r},lM=(n,c)=>.97*Math.pow(c/(c-1),n);
const mEnd=a=>{const g=a.mines,mult=mM(g.open.length,g.m),pay=Math.floor(g.bet*mult);a.bal+=pay;fin(a,'mines',g.bet,pay,1);a.mines=null;return{payout:pay,mult,mines:g.set,balance:a.bal}};
const lEnd=a=>{const g=a.ladder,mult=lM(g.picks.length,g.c),pay=Math.floor(g.bet*mult);a.bal+=pay;fin(a,'ladder',g.bet,pay,1);a.ladder=null;return{payout:pay,mult,traps:g.traps,balance:a.bal}};
const cm=c=>Math.exp(.15*Math.max(0,now()-c.t0)/1000);
const online=()=>Object.values(D.users).filter(u=>now()-u.seen<3e5).length;
const find=q=>{q=String(q||'').replace('@','').trim().toLowerCase();return Object.values(D.users).find(x=>String(x.id)===q||x.name.toLowerCase()===q)};
const view=u=>({id:u.id,name:u.name,balance:u.main.bal,wag:u.main.wag,ups:u.main.ups,best:u.main.best,admin:isAdm(u),banned:banned(u),frozen:u.frozen,
 ban_until:banned(u)&&u.banT?'до '+new Date(u.banT).toLocaleString('ru-RU'):null});
const sumDay=(k,n=1)=>{let s=0;for(let i=0;i<n;i++){const d=D.day[new Date(now()-i*864e5).toISOString().slice(0,10)];if(d)s+=d[k]||0}return s};
const needAdm=f=>(a,b,u,q)=>isAdm(u)?f(a,b,u,q):E('Недоступно'),needOwn=f=>(a,b,u,q)=>isOwner(u)?f(a,b,u,q):E('Недоступно');

const H={
state:(a,b,u)=>({admin:isAdm(u),owner:isOwner(u),balance:a.bal,wag:a.wag,ups:a.ups,wins:a.wins,best:a.best,id:u.id,name:u.name,wheel_left:left(a),wd_left:Math.max(0,50000-(a.wdDate===dk()?a.wdDay:0)),online:online(),cfg:CFG,
 mines:a.mines&&{m:a.mines.m,bet:a.mines.bet,open:a.mines.open},ladder:a.ladder&&{c:a.ladder.c,bet:a.ladder.bet,picks:a.ladder.picks}}),
sync:(a,b,u)=>({balance:a.bal-(a.wp&&now()<a.wp.t?a.wp.v:0),wag:a.wag,ups:a.ups,wins:a.wins,best:a.best,online:online(),admin:isAdm(u),owner:isOwner(u)}),
top:(a,b,u,q)=>{const day=/p=day/.test(q),t=dk();return{top:Object.values(D.users).map(x=>({name:x.name,wag:day?(x.d[t]||0):Object.values(x.d).reduce((s,v)=>s+v,0)})).filter(x=>x.wag>0).sort((x,y)=>y.wag-x.wag).slice(0,10)}},
async deposit(a,b,u){const n=Math.floor(b.amount);if(!(n>=1&&n<=1e6))return E('Сумма от 1 до 1 000 000 ★');
 if(!a.m){a.bal+=n;return{balance:a.bal,amount:n,test:1}}
 const r=await tg('createInvoiceLink',{title:'Пополнение RubUp',description:n+' ★ на игровой баланс',payload:'dep:'+u.id+':'+n,provider_token:'',currency:'XTR',prices:[{label:'★',amount:n}]});
 return r.ok?{link:r.result,amount:n}:E('Оплата недоступна: '+(r.description||'ошибка'))},
withdraw:(a,b,u)=>{const n=Math.floor(b.amount);if(!(n>=1))return E('Введите сумму');if(u.frozen)return E('Вывод заморожен');if(n>a.bal)return E('Недостаточно звёзд');
 if(a.wdDate!==dk()){a.wdDate=dk();a.wdDay=0}const l=50000-a.wdDay;if(n>l)return E('Лимит вывода на сегодня: '+l+' ★');
 a.bal-=n;a.wdDay+=n;if(a.m){const w={id:D.wd.length+1,uid:u.id,name:u.name,amount:n,ts:now(),status:'pending'};D.wd.push(w);u.wdn+=n;D.tot.wd+=n;dayAdd('wd',n);
  for(const id of new Set([OWNER,...ADMINS]))if(id)say(id,`💸 Заявка #${w.id}: @${u.name} (${u.id}) выводит ${n} ★\n/done ${w.id} — выплачено\n/reject ${w.id} — вернуть на баланс`)}
 return{balance:a.bal,pending:a.m?1:0}},
'promo/use':(a,b,u)=>{const c=String(b.code||'').trim().toUpperCase(),p=D.promos[c];if(!p)return E('Промокод не найден');if(u.pu.includes(c))return E('Вы уже активировали этот промокод');
 if(p.uses&&p.used>=p.uses)return E('Лимит активаций исчерпан');if(p.exp&&p.exp<now())return E('Срок промокода истёк');p.used++;u.pu.push(c);a.bal+=p.amount;if(a.m)D.tot.given+=p.amount;return{balance:a.bal,amount:p.amount}},
'wheel/spin':a=>{if(a.wag<100)return E('Сыграйте ещё на '+(100-a.wag)+' ★');if(left(a)>0)return E('Рано, подождите');
 const w=WH.map(p=>p>=500?1:p>=100?3:p>=50?6:12);let r=rnd()*w.reduce((x,y)=>x+y),idx=0;while(r>=w[idx]){r-=w[idx];idx++}
 const prize=WH[idx];a.bal+=prize;a.wlAt=now()+45000;a.wp={v:prize,t:now()+5400};if(a.m)D.tot.given+=prize;return{idx,prize,balance:a.bal,left:45}},
up:(a,b)=>{const e=chk(a,b.bet);if(e)return e;const{bet,x}=b;if(!(x>=1.58&&x<=90))return E('Неверный множитель');
 const r=rnd(),win=r<.9/x,pay=win?Math.floor(bet*x):0;a.bal+=pay-bet;a.ups++;fin(a,'up',bet,pay,win);return{r,win,pay,balance:a.bal}},
'mines/start':(a,b)=>{const e=chk(a,b.bet);if(e)return e;if(a.mines)return E('Раунд уже идёт');if(![1,3,5,10,20].includes(b.mines))return E('Неверное число мин');
 a.bal-=b.bet;a.mines={m:b.mines,bet:b.bet,open:[],set:pick(25,b.mines)};return{balance:a.bal}},
'mines/cashout':a=>a.mines&&a.mines.open.length?mEnd(a):E('Нечего забирать'),
'ladder/start':(a,b)=>{const e=chk(a,b.bet);if(e)return e;if(a.ladder)return E('Раунд уже идёт');if(![2,3,4].includes(b.c))return E('Неверный режим');
 a.bal-=b.bet;a.ladder={c:b.c,bet:b.bet,picks:[],traps:Array.from({length:8},()=>ri(b.c))};return{balance:a.bal}},
'ladder/pick':(a,b)=>{const g=a.ladder;if(!g)return E('Нет активной игры');const r=g.picks.length;if(!(b.i>=0&&b.i<g.c))return E('Неверная клетка');
 if(g.traps[r]===b.i){a.ladder=null;fin(a,'ladder',g.bet,0,0);return{boom:true,traps:g.traps,balance:a.bal}}g.picks.push(b.i);return g.picks.length===8?lEnd(a):{ok:1}},
'ladder/cashout':a=>a.ladder&&a.ladder.picks.length?lEnd(a):E('Нечего забирать'),
'plinko/play':(a,b)=>{const e=chk(a,b.bet);if(e)return e;const path=Array.from({length:12},()=>ri(2)),mult=PM[path.reduce((x,y)=>x+y,0)],pay=Math.floor(b.bet*mult);
 a.bal+=pay-b.bet;fin(a,'plinko',b.bet,pay,mult>1);return{path,mult,payout:pay,balance:a.bal}},
'crash/start':(a,b)=>{const e=chk(a,b.bet);if(e)return e;if(a.crash)return E('Раунд уже идёт');a.bal-=b.bet;const au=+b.auto;
 a.crash={bet:b.bet,auto:au>=1.01?au:0,cp:Math.min(1000,Math.max(1,Math.floor(97/(1-rnd()))/100)),t0:now()+2100,pay:0};fin(a,'crash',b.bet,0,0);return{balance:a.bal}},
'crash/status':a=>{const c=a.crash;if(!c)return E('Нет игры');const m=cm(c);
 if(!c.pay&&c.auto&&c.auto<=m&&c.auto<c.cp)crPay(a,c,c.auto);
 const crashed=m>=c.cp,o={cashed:c.pay,balance:a.bal,crashed,cp:c.cp,m};if(crashed)a.crash=null;return o},
'crash/cash':a=>{const c=a.crash;if(!c)return E('Нет игры');if(c.pay)return{pay:c.pay,mult:c.pay/c.bet,balance:a.bal};const m=cm(c);
 if(m>=c.cp){a.crash=null;return{crashed:true,cp:c.cp}}const mult=Math.floor(m*100)/100;crPay(a,c,mult);return{pay:c.pay,mult,balance:a.bal}},
/* --- админка --- */
'admin/stats':needAdm(()=>{const us=Object.values(D.users),pg=Object.fromEntries(Object.entries(D.pg).map(([k,v])=>[k,Math.round(v)])),pend=D.wd.filter(w=>w.status==='pending');
 return{users:us.length,online:online(),new24:us.filter(x=>now()-x.t0<864e5).length,wag24:sumDay('wag'),bot:0,debt:us.reduce((s,x)=>s+x.main.bal,0),dep_total:D.tot.dep,dep24:sumDay('dep'),
  wd_total:D.tot.wd,wd24:sumDay('wd'),pend:pend.length,wd_pend:pend.reduce((s,w)=>s+w.amount,0),given:D.tot.given,wag_total:D.tot.wag,profit:Math.round(Object.values(D.pg).reduce((s,v)=>s+v,0)),pg}}),
'admin/user':needAdm((a,b)=>{const t=find(b.q);return t?{user:view(t)}:E('Игрок не найден')}),
'admin/balance':needAdm((a,b)=>{const t=D.users[b.id];if(!t)return E('Игрок не найден');t.main.bal=Math.max(0,t.main.bal+Math.floor(b.amount));if(b.amount>0)D.tot.given+=b.amount;return{balance:t.main.bal}}),
'admin/zero':needAdm((a,b)=>{const t=D.users[b.id];if(!t)return E('Игрок не найден');t.main.bal=0;return{ok:1}}),
'admin/ban':needAdm((a,b)=>{const t=D.users[b.id];if(!t)return E('Игрок не найден');t.banned=!!b.on;t.banT=b.on&&b.duration?now()+b.duration*(b.unit==='d'?864e5:36e5):0;return{ok:1}}),
'admin/freeze':needAdm((a,b)=>{const t=D.users[b.id];if(!t)return E('Игрок не найден');t.frozen=!!b.on;return{ok:1}}),
'admin/setadmin':needOwn((a,b)=>{const t=b.on?getUser(+b.id):D.users[b.id];if(!t)return E('Игрок не найден');t.admin=!!b.on;return{ok:1}}),
'admin/pstats':needAdm((a,b)=>{const t=D.users[b.id];if(!t)return E('Игрок не найден');return{stats:{deposited:t.dep,withdrawn:t.wdn,won:t.main.won,lost:t.main.lost,wagered:t.main.wag,games:t.games}}}),
'admin/frozen':needAdm(()=>({items:Object.values(D.users).filter(x=>x.frozen).map(x=>({id:x.id,name:x.name,balance:x.main.bal}))})),
'admin/admins':needOwn(()=>({items:Object.values(D.users).filter(x=>isAdm(x)).map(x=>({id:x.id,name:x.name,owner:isOwner(x)}))})),
'admin/giveall':needOwn((a,b)=>{const n=Math.floor(b.amount);if(!(n>0))return E('Сумма больше 0');const us=Object.values(D.users);us.forEach(x=>x.main.bal+=n);D.tot.given+=n*us.length;return{count:us.length}}),
'admin/zeroall':needOwn(()=>{const us=Object.values(D.users);us.forEach(x=>x.main.bal=0);return{count:us.length}}),
'admin/broadcast':needOwn((a,b)=>{const us=Object.values(D.users);(async()=>{for(const x of us){await say(x.id,String(b.text).slice(0,3500));await new Promise(r=>setTimeout(r,60))}})();return{count:us.length}}),
'admin/testreset':needAdm((a,b,u)=>{u.test=mk(100000,0);return{ok:1}}),
'admin/promo/create':needAdm((a,b)=>{const c=String(b.code||crypto.randomBytes(3).toString('hex')).toUpperCase();if(!(b.amount>0))return E('Сумма больше 0');
 D.promos[c]={amount:Math.floor(b.amount),uses:b.uses||0,used:0,exp:b.hours?now()+b.hours*36e5:0};return{code:c}}),
'admin/promo/list':needAdm(()=>({items:Object.entries(D.promos).map(([code,p])=>({code,amount:p.amount,used:p.used,uses:p.uses,expires:p.exp?new Date(p.exp).toLocaleString('ru-RU'):''}))})),
'admin/promo/delete':needAdm((a,b)=>{delete D.promos[b.code];return{ok:1}})};
function crPay(a,c,mult){c.pay=Math.floor(c.bet*mult);a.bal+=c.pay;a.wins++;a.best=Math.max(a.best,c.pay);a.won+=c.pay;if(a.m)D.pg.crash-=c.pay}
H['mines/open']=(a,b)=>{const g=a.mines;if(!g)return E('Нет активной игры');const i=b.i;if(!(i>=0&&i<25)||g.open.includes(i))return E('Клетка уже открыта');
 if(g.set.includes(i)){a.mines=null;fin(a,'mines',g.bet,0,0);return{boom:true,mines:g.set,balance:a.bal}}g.open.push(i);return g.open.length===25-g.m?mEnd(a):{ok:1}};
const GAMES=/^(up|mines\/|ladder\/|plinko|crash\/start|wheel)/;

/* ---------- HTTP ---------- */
const readBody=req=>new Promise(r=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e5)req.destroy()});req.on('end',()=>{try{r(JSON.parse(s||'{}'))}catch(e){r({})}})});
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='POST'&&req.url===HOOK){const up=await readBody(req);res.writeHead(200);res.end('ok');onUpdate(up).catch(console.error);return}
  if(req.method==='GET'&&(req.url==='/'||req.url.startsWith('/?')||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')))}
  if(req.method!=='POST'||!req.url.startsWith('/api/'))return send(res,404,E('not found'));
  const q=req.url.slice(5),k=q.split('?')[0],h=H[k];if(!h)return send(res,404,E('Неизвестный метод'));
  const tu=checkInit(req.headers['x-init']||'');if(!tu){console.log('auth fail:',checkInit.why,'| init длина',(req.headers['x-init']||'').length);return send(res,401,E('Откройте через Telegram ('+checkInit.why+')'))}
  const u=getUser(tu.id,tu.username||tu.first_name||'');u.seen=now();
  if(banned(u))return send(res,200,E('Аккаунт заблокирован'));
  const a=(req.headers['x-test']==='1'&&isAdm(u))?u.test:u.main;
  const out=await h(a,await readBody(req),u,q);if(GAMES.test(k)&&out&&!out.error)u.games++;
  if(a.m&&a.wag!==a._w){const w=a.wag-(a._w||0);if(w>0)u.d[dk()]=(u.d[dk()]||0)+w;a._w=a.wag;const ks=Object.keys(u.d).sort();while(ks.length>7)delete u.d[ks.shift()]}
  dirty=1;send(res,200,out);
 }catch(e){console.error(e);send(res,500,E('Ошибка сервера'))}
});

/* ---------- бот: обновления приходят на webhook (/tg/...) ---------- */
async function onUpdate(up){
 if(up.pre_checkout_query){return void tg('answerPreCheckoutQuery',{pre_checkout_query_id:up.pre_checkout_query.id,ok:true})}
 const m=up.message;if(!m)return;const id=m.from.id;
 if(m.successful_payment){const sp=m.successful_payment,cid=sp.telegram_payment_charge_id;
  if(sp.currency!=='XTR'||D.paid[cid])return;D.paid[cid]=1;const u=getUser(id,m.from.username||m.from.first_name),n=sp.total_amount;
  u.main.bal+=n;u.dep+=n;D.tot.dep+=n;dayAdd('dep',n);dirty=1;return void say(id,`✅ Зачислено ${n} ★`)}
 const t=(m.text||'').trim();
 if(t.startsWith('/start')){getUser(id,m.from.username||m.from.first_name);dirty=1;
  return void say(id,'Добро пожаловать в RubUp 🎰',BASE?{reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:BASE}}]]}}:{})}
 if(!isAdm(getUser(id)))return;
 let x;if(t==='/wd'){const p=D.wd.filter(w=>w.status==='pending');return void say(id,p.length?p.map(w=>`#${w.id} @${w.name} (${w.uid}) — ${w.amount} ★`).join('\n'):'Нет заявок')}
 if((x=t.match(/^\/(done|reject)\s+(\d+)/))){const w=D.wd.find(v=>v.id===+x[2]);if(!w||w.status!=='pending')return void say(id,'Заявка не найдена');
  if(x[1]==='done'){w.status='done';say(w.uid,`✅ Вывод ${w.amount} ★ выплачен`)}
  else{w.status='rejected';const u=D.users[w.uid];u.main.bal+=w.amount;u.wdn-=w.amount;D.tot.wd-=w.amount;say(w.uid,`Заявка на вывод ${w.amount} ★ отклонена, звёзды возвращены`)}
  dirty=1;return void say(id,'Готово')}
}
async function poll(){let off=0;for(;;){const r=await tg('getUpdates',{offset:off,timeout:25,allowed_updates:['message','pre_checkout_query']});
 if(!r.ok){await new Promise(x=>setTimeout(x,3000));continue}for(const up of r.result){off=up.update_id+1;try{await onUpdate(up)}catch(e){console.error(e)}}}}
load().then(()=>{
 server.listen(PORT,'0.0.0.0',async()=>{console.log('RubUp на порту '+PORT);
  if(!BASE)return console.log('Нет WEBAPP_URL — webhook не установлен');
  const r=await tg('setWebhook',{url:BASE+HOOK,allowed_updates:['message','pre_checkout_query']});console.log('webhook:',r.ok,r.description||'');
  if(!r.ok){console.log('webhook не вышел — включаю polling');await tg('deleteWebhook');poll()}
  await tg('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url:BASE}}})})
}).catch(e=>{console.error('Старт не удался:',e.message);process.exit(1)});
