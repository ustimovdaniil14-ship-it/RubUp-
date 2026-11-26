'use strict';
// RubUp — сервер (Render + Neon Postgres). Единственная зависимость: pg.
const http=require('http'),fs=require('fs'),crypto=require('crypto'),path=require('path');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}}catch(e){}
const TOKEN=process.env.BOT_TOKEN||'',TGAPI=(()=>{const u=(process.env.API_BASE||'https://api.telegram.org').trim().replace(/\/+$/,'');return /^https?:\/\//i.test(u)?u:'http://'+u})(),
 PORT=+process.env.PORT||3000,
 ADMINS=(process.env.ADMIN_IDS||'').split(',').map(s=>+s.trim()).filter(Boolean),OWNER=ADMINS[0];
const SELL_PCT=+process.env.SELL_PCT||100;
const IT={st5:['5 звёзд',5,'s'],st10:['10 звёзд',10,'s'],heart:['Сердце',15,'g'],bear:['Мишка',15,'g'],gift:['Подарок',25,'g'],rose:['Роза',25,'g'],cake:['Торт',50,'g'],bouquet:['Букет',50,'g'],rocket:['Ракета',50,'g'],champagne:['Шампанское',50,'g'],trophy:['Кубок',100,'g'],ring:['Кольцо',100,'g'],diamond:['Алмаз',100,'g'],
 tama:['Tama Gadget',125,'n'],hat:['Witch Hat',125,'n'],sparkler:['Party Sparkler',125,'n'],ramen:['Instant Ramen',125,'n'],frog:['Kissed Frog',125,'n'],globe:['Snow Globe',125,'n'],clover:['Clover Pin',125,'n'],key:['Input Key',125,'n'],cupcake:['Whip Cupcake',125,'n']};
const CASES=[
 {id:'daily',n:'Ежедневный',p:0,cd:24,it:[['st5',45],['st10',30],['heart',12],['bear',8],['gift',3],['rose',1.5],['cake',.4],['trophy',.1]]},
 {id:'mini',n:'Мини',p:25,it:[['heart',33],['bear',27],['gift',17],['rose',12],['cake',6],['rocket',2.5],['champagne',1.5],['bouquet',1]]},
 {id:'classic',n:'Классик',p:100,it:[['cake',10],['bouquet',8],['rocket',8],['champagne',8],['trophy',12],['ring',11],['diamond',11],['tama',3.55],['hat',3.55],['sparkler',3.55],['ramen',3.55],['frog',3.55],['globe',3.55],['clover',3.55],['key',3.55],['cupcake',3.6]]}];
const mask=n=>{n=String(n||'?');return n.length>4?n.slice(0,2)+'…'+n.slice(-2):n[0]+'…'};
const WMW_=+(process.env.WHEEL_MIN_WAG||0),WCD=Math.round(3600*(+process.env.WHEEL_COOLDOWN_H||24)),MIN_WD=+process.env.MIN_WD||15,WD_LIM=+process.env.WD_LIMIT||35000;
const PAYOUT={method:process.env.PAYOUT_METHOD||'sendStars',params:(()=>{try{return JSON.parse(process.env.PAYOUT_PARAMS||'{"user_id":"{uid}","amount":"{amount}"}')}catch(e){return{}}})()};
const alertAdm=t=>{if(now()-(alertAdm.t||0)<3e5)return;alertAdm.t=now();for(const id of new Set([OWNER,...ADMINS]))if(id)say(id,t)};
const fill=(o,v)=>JSON.parse(JSON.stringify(o),(k,x)=>x==='{uid}'?v.uid:x==='{amount}'?v.amount:x);
async function giftList(){if(giftList.c&&now()-giftList.t<3e5)return giftList.c;
 const r=await tg('getAvailableGifts',{});const l=(r.ok&&r.result&&r.result.gifts||[]).filter(x=>!x.total_count&&!x.remaining_count).sort((x,y)=>y.star_count-x.star_count);
 if(l.length){giftList.c=l;giftList.t=now()}return l}
async function giftPayout(uid,n){const g=await giftList();if(!g.length)return{paid:0,err:'нет доступных подарков'};
 let rest=n,paid=0,sent=0,err='';
 for(const x of g){while(rest>=x.star_count&&sent<20&&!err){const r=await tg('sendGift',{user_id:uid,gift_id:x.id,text:'Вывод из RubUp'});console.log('sendGift',x.star_count,r.ok,r.description||'');
   if(!r.ok){err=r.description||'ошибка';break}rest-=x.star_count;paid+=x.star_count;sent++}if(err)break}
 return{paid,err}}
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
const hide=t=>String(t==null?'':t).split(TOKEN).join('***'); // токен НИКОГДА не должен попадать в тексты ошибок
async function tg(method,body){try{const r=await fetch(`${TGAPI}/bot${TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
 let j;try{j=await r.json()}catch(e){j={ok:false,description:'HTTP '+r.status}}if(!r.ok&&!j.error_code)j.error_code=r.status;if(j.description)j.description=hide(j.description);return j}
 catch(e){const c=e.cause;return{ok:false,description:'нет связи с платформой'+(c&&c.code?' ('+hide(c.code)+')':'')}}}
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
const CFG={wheel:WH.map(p=>({p})),wheel_min_wag:WMW_,wd_min:MIN_WD,payout:PAYOUT.method,wd_limit:WD_LIM,support:process.env.SUPPORT||'Techiqqe',botlink:process.env.BOT_LINK||'',up_edge:.9,up_top:.57,up_low:.01,up_min_x:1.58,up_max_x:90,mines_edge:.97,ladder_edge:.97,mines_win:null,max_bet:50000,ladder_rows:8,plinko:PM};
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
state:(a,b,u)=>({admin:isAdm(u),owner:isOwner(u),balance:a.bal,wag:a.wag,ups:a.ups,wins:a.wins,best:a.best,id:u.id,name:u.name,wheel_left:left(a),wd_left:Math.max(0,WD_LIM-(a.wdDate===dk()?a.wdDay:0)),online:online(),cfg:CFG,
 mines:a.mines&&{m:a.mines.m,bet:a.mines.bet,open:a.mines.open},ladder:a.ladder&&{c:a.ladder.c,bet:a.ladder.bet,picks:a.ladder.picks}}),
sync:(a,b,u)=>({balance:a.bal-(a.wp&&now()<a.wp.t?a.wp.v:0),wag:a.wag,ups:a.ups,wins:a.wins,best:a.best,online:online(),admin:isAdm(u),owner:isOwner(u)}),
top:(a,b,u,q)=>{const day=/p=day/.test(q),t=dk();return{top:Object.values(D.users).map(x=>({name:x.name,wag:day?(x.d[t]||0):Object.values(x.d).reduce((s,v)=>s+v,0)})).filter(x=>x.wag>0).sort((x,y)=>y.wag-x.wag).slice(0,10)}},
async deposit(a,b,u){const n=Math.floor(b.amount);if(!(n>=1&&n<=1e6))return E('Сумма от 1 до 1 000 000 ★');
 if(!a.m){a.bal+=n;return{balance:a.bal,amount:n,test:1}}
 const inv={title:'Пополнение RubUp',description:n+' ★ на игровой баланс',payload:'dep:'+u.id+':'+n,provider_token:'',currency:'XTR',prices:[{label:'★',amount:n}]};
 const sd=await tg('sendInvoice',{chat_id:u.id,...inv});console.log('sendInvoice:',sd.ok,sd.description||'');
 if(sd.ok)return{sent:1,amount:n};
 const r=await tg('createInvoiceLink',inv);console.log('createInvoiceLink:',r.ok,r.description||'',String(r.result||'').slice(0,80));
 return r.ok?{link:r.result,amount:n}:E('Оплата недоступна: '+(sd.description||r.description||'ошибка'))},
async withdraw(a,b,u){const n=Math.floor(b.amount);if(!(n>=1))return E('Введите сумму');
 const gl=(PAYOUT.method==='gifts'&&a.m)?await giftList():[],min=Math.max(MIN_WD,gl.length?gl[gl.length-1].star_count:0);if(a.m&&n<min)return E('Минимум для вывода '+min+' ★');
 if(u.frozen)return E('Вывод заморожен');if(n>a.bal)return E('Недостаточно звёзд');
 if(a.wdDate!==dk()){a.wdDate=dk();a.wdDay=0}const l=WD_LIM-a.wdDay;if(n>l)return E('Лимит вывода на сегодня: '+l+' ★');
 a.bal-=n;a.wdDay+=n;if(!a.m)return{balance:a.bal};
 const w={id:D.wd.length+1,uid:u.id,name:u.name,amount:n,ts:now(),status:'pending'};
 let why=PAYOUT.method==='manual'?'включён ручной режим (PAYOUT_METHOD=manual)':PAYOUT.method==='gifts'?'подарки недоступны (getAvailableGifts пуст)':'';
 if(PAYOUT.method==='gifts'&&gl.length){const r=await giftPayout(u.id,n);
  if(!r.paid){a.bal+=n;a.wdDay-=n;return E('Автовывод не удался: '+(r.err||'сумма меньше самого дешёвого подарка'))}
  const back=n-r.paid;a.bal+=back;a.wdDay-=back;w.amount=r.paid;w.status='done';D.wd.push(w);u.wdn+=r.paid;D.tot.wd+=r.paid;dayAdd('wd',r.paid);
  say(u.id,`🎁 Вывод ${r.paid} ★ отправлен подарками. Откройте их в чате и обменяйте на звёзды.`+(back?`\nНе хватило на целый подарок: ${back} ★ осталось на балансе.`:''));
  return{balance:a.bal,auto:1,paid:r.paid}}
 if(PAYOUT.method&&PAYOUT.method!=='gifts'&&PAYOUT.method!=='manual'){
  const r=await tg(PAYOUT.method,fill(PAYOUT.params,{uid:u.id,amount:n}));console.log('payout:',r.ok,r.error_code||'',r.description||'');
  if(r.ok){w.status='done';D.wd.push(w);u.wdn+=n;D.tot.wd+=n;dayAdd('wd',n);say(u.id,`✅ Вывод ${n} ★ отправлен на ваш аккаунт`);return{balance:a.bal,auto:1}}
  if(r.error_code!==404){a.bal+=n;a.wdDay-=n;alertAdm(`⚠️ ${PAYOUT.method} не сработал: ${r.description||'ошибка'} (код ${r.error_code||'-'})\nПараметры: ${JSON.stringify(fill(PAYOUT.params,{uid:u.id,amount:n}))}\nПодберите их командой /paytest`);return E('Вывод временно недоступен, попробуйте позже')}why=PAYOUT.method+': метод не найден на платформе (404)'}
 D.wd.push(w);u.wdn+=n;D.tot.wd+=n;dayAdd('wd',n);
 for(const id of new Set([OWNER,...ADMINS]))if(id)say(id,`💸 Заявка #${w.id}: @${u.name} (${u.id}) выводит ${n} ★\n/done ${w.id} — выплачено\n/reject ${w.id} — вернуть на баланс`+(why?`\n⚠️ Автовывод не сработал: ${why}`:''));
 return{balance:a.bal,pending:1}},
ops:(a,b,u)=>{if(!a.m)return{items:[]};const it=[...(u.ops||[]).map(o=>({k:'dep',n:o.n,t:o.t,s:'done'})),...D.wd.filter(w=>w.uid===u.id).slice(-20).map(w=>({k:'wd',n:w.amount,t:w.ts,s:w.status}))].sort((x,y)=>y.t-x.t).slice(0,25);return{items:it}},
cases:a=>({sell:SELL_PCT,inv:(a.inv||[]).filter(x=>x.s!=='sold').length,cases:CASES.map(c=>{const T=c.it.reduce((q,x)=>q+x[1],0);return{id:c.id,n:c.n,p:c.p,left:c.cd?Math.max(0,Math.ceil(((a.cd&&a.cd[c.id]||0)-now())/1000)):0,it:c.it.map(([i,w])=>({i,n:IT[i][0],v:IT[i][1],k:IT[i][2],c:Math.round(w/T*1000)/10}))}})}),
'case/open':(a,b,u)=>{const c=CASES.find(x=>x.id===b.id);if(!c)return E('Кейс не найден');
 if(c.p){const e=chk(a,c.p);if(e)return e}else{a.cd=a.cd||{};if((a.cd[c.id]||0)>now())return E('Бесплатный кейс ещё недоступен')}
 const T=c.it.reduce((q,x)=>q+x[1],0);let r=rnd()*T,id=c.it[0][0];for(const [i,w] of c.it){if(r<w){id=i;break}r-=w}
 const [n,v,k]=IT[id];if(c.p){a.bal-=c.p;fin(a,'cases',c.p,v,v>=c.p)}else{a.cd[c.id]=now()+c.cd*36e5;if(a.m)D.tot.given+=v}
 const o={item:{i:id,n,v,k}};
 if(k==='s')a.bal+=v;else{a.inv=a.inv||[];const it={u:crypto.randomBytes(4).toString('hex'),i:id,s:'have',t:now()};a.inv.push(it);o.u=it.u}
 if(a.m&&v>=50){D.feed=D.feed||[];D.feed.push({n:mask(u.name),i:id,t:now()});if(D.feed.length>40)D.feed.shift()}
 o.balance=a.bal;return o},
feed:()=>({items:(D.feed||[]).slice(-20).reverse().map(f=>({n:f.n,i:f.i,nm:IT[f.i][0],v:IT[f.i][1]}))}),
inv:a=>({items:(a.inv||[]).filter(x=>x.s!=='sold').map(x=>({u:x.u,i:x.i,n:IT[x.i][0],v:IT[x.i][1],k:IT[x.i][2],s:x.s}))}),
'inv/sell':(a,b)=>{const x=(a.inv||[]).find(y=>y.u===b.u&&y.s==='have');if(!x)return E('Предмет недоступен');const g=Math.floor(IT[x.i][1]*SELL_PCT/100);x.s='sold';a.bal+=g;return{balance:a.bal,got:g}},
'inv/out':(a,b,u)=>{const x=(a.inv||[]).find(y=>y.u===b.u&&y.s==='have');if(!x)return E('Предмет недоступен');if(!a.m)return E('В тестовом режиме вывод недоступен');
 x.s='req';D.nreq=D.nreq||[];const w={id:D.nreq.length+1,uid:u.id,name:u.name,it:x.i,u:x.u,ts:now(),st:'pending'};D.nreq.push(w);
 for(const id of new Set([OWNER,...ADMINS]))if(id)say(id,`🎁 Заявка на выдачу #${w.id}: @${u.name} (${u.id})\n${IT[x.i][0]} · ${IT[x.i][1]} ★\n/given ${w.id} — выдан\n/rej ${w.id} — вернуть в инвентарь`);return{ok:1}},
'promo/use':(a,b,u)=>{const c=String(b.code||'').trim().toUpperCase(),p=D.promos[c];if(!p)return E('Промокод не найден');if(u.pu.includes(c))return E('Вы уже активировали этот промокод');
 if(p.uses&&p.used>=p.uses)return E('Лимит активаций исчерпан');if(p.exp&&p.exp<now())return E('Срок промокода истёк');p.used++;u.pu.push(c);a.bal+=p.amount;if(a.m)D.tot.given+=p.amount;return{balance:a.bal,amount:p.amount}},
'wheel/spin':a=>{if(a.wag<WMW_)return E('Сыграйте ещё на '+(WMW_-a.wag)+' ★');if(left(a)>0)return E('Рано, подождите');
 const w=WH.map(p=>p>=500?1:p>=100?3:p>=50?6:12);let r=rnd()*w.reduce((x,y)=>x+y),idx=0;while(r>=w[idx]){r-=w[idx];idx++}
 const prize=WH[idx];a.bal+=prize;a.wlAt=now()+WCD*1000;a.wp={v:prize,t:now()+5400};if(a.m)D.tot.given+=prize;return{idx,prize,balance:a.bal,left:WCD}},
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
 }catch(e){console.error(hide(e&&e.stack||e));send(res,500,E('Ошибка сервера'))}
});

/* ---------- бот: обновления приходят на webhook (/tg/...) ---------- */
async function onUpdate(up){
 if(up.pre_checkout_query){return void tg('answerPreCheckoutQuery',{pre_checkout_query_id:up.pre_checkout_query.id,ok:true})}
 const m=up.message;if(!m)return;const id=m.from.id;
 if(m.successful_payment){const sp=m.successful_payment,cid=sp.telegram_payment_charge_id;
  if(sp.currency!=='XTR'||D.paid[cid])return;D.paid[cid]=1;const u=getUser(id,m.from.username||m.from.first_name),n=sp.total_amount;
  u.main.bal+=n;u.dep+=n;D.tot.dep+=n;(u.ops=u.ops||[]).push({n,t:now()});if(u.ops.length>30)u.ops.shift();dayAdd('dep',n);dirty=1;return void say(id,`✅ Зачислено ${n} ★`)}
 const t=(m.text||'').trim();
 if(t.startsWith('/start')){if(/invoice/.test(t))console.log('start-param:',t);getUser(id,m.from.username||m.from.first_name);dirty=1;
  return void say(id,'Добро пожаловать в RubUp 🎰',BASE?{reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:BASE}}]]}}:{})}
 if(!isAdm(getUser(id)))return;
 if(t==='/probe'){const names='getMe getMyStarBalance getStarTransactions refundStarPayment sendInvoice createInvoiceLink answerPreCheckoutQuery sendGift getAvailableGifts sendStars sendStar giftStars giveStars transferStars transferStar starTransfer sendStarsToUser payUser payoutStars createPayout requestPayout withdrawStars withdraw withdrawalRequest cashout sendReward rewardUser creditStars addStars grantStars awardStars sendBalance topUp transferBalance sendCoins sendPayment createTransfer starsWithdraw claimStars getBotStars getBotStarBalance getStarsBalance getBalance getMyBalance getStarBalance getWalletBalance getBusinessAccountStarBalance transferBusinessAccountStars getStarSubscriptions convertGiftToStars getBusinessAccountGifts transferGift sendPaidMedia setMyStarPayoutAddress getStarPayout sendStatics sendStatic sendMoney transfer getStars getBotBalance getStatics createWithdrawal sendPayout payout giftPremiumSubscription getMyStarRevenue getStarRevenue getRevenue'.split(' '),out=[];
  for(const m of names){const r=await tg(m,{});const nf=r.error_code===404||/not found|unknown|no such/i.test(r.description||'');if(!nf)out.push('✓ '+m+' — '+String(r.description||'ok').slice(0,60))}
  return void say(id,`Найдено методов: ${out.length} из ${names.length}\n`+out.join('\n'))}
 if(t==='/gifts'){const r=await tg('getAvailableGifts',{}),l=(r.ok&&r.result&&r.result.gifts)||[];
  const out=['Подарков: '+l.length,'Цены ★: '+l.map(x=>x.star_count).join(', ').slice(0,350),'Первый подарок (сырой ответ):\n'+JSON.stringify(l[0]||r).slice(0,900)];
  const fid=l[0]&&l[0].sticker&&l[0].sticker.file_id;if(fid){const f=await tg('getFile',{file_id:fid});out.push('getFile для картинки: '+JSON.stringify(f).slice(0,300))}else out.push('В подарке нет поля sticker с картинкой');
  return void say(id,out.join('\n\n'))}
  if(t==='/bal'){const r1=await tg('getMyStarBalance',{}),r2=await tg('getStarBalance',{});
  const f=r=>r.ok?JSON.stringify(r.result).slice(0,200):'ошибка: '+(r.description||r.error_code);
  return void say(id,'getMyStarBalance → '+f(r1)+'\ngetStarBalance → '+f(r2))}
 if(t==='/tx'){const r=await tg('getStarTransactions',{limit:5});return void say(id,r.ok?('Последние операции (сырой ответ):\n'+JSON.stringify(r.result).slice(0,3500)):'Не удалось: '+(r.description||'ошибка'))}
 if(t==='/paytest'){const meth=['gifts','manual'].includes(PAYOUT.method)?'sendStars':PAYOUT.method,out=[`Пробую ${meth} (1 ★ вам):`];
  const r0=await tg(meth,{}),r1=await tg(meth,{user_id:id});out.push('без параметров → '+(r0.description||r0.error_code),'только user_id → '+(r1.description||r1.error_code));
  const names=['amount','star_count','stars','count','quantity'],extras=[{},{currency:'XTR'},{payload:'rubup'},{text:'RubUp'},{comment:'RubUp'},{reason:'RubUp'},{currency:'XTR',payload:'rubup'}],seen={};let okk=0;
  for(const n of names){for(const ex of extras){const v={user_id:'{uid}',[n]:'{amount}',...ex},r=await tg(meth,fill(v,{uid:id,amount:1}));
   if(r.ok){okk=1;PAYOUT.params=v;D.payoutParams=v;dirty=1;out.push('✅ Подошло: '+Object.keys(v).join(' + '),'Параметры сохранены, 1 ★ отправлена вам.');break}
   const d=r.description||r.error_code;(seen[d]=seen[d]||[]).push(n+(Object.keys(ex).length?'+'+Object.keys(ex).join('+'):''))}if(okk)break}
  if(!okk){for(const d in seen)out.push('✗ '+d+' ×'+seen[d].length+(seen[d].length<4?' ('+seen[d].join(', ')+')':''));out.push('Ни один вариант не подошёл. Перешлите это админу платформы: нужны точные параметры '+meth+'.')}
  return void say(id,out.join('\n'))}
 if(t==='/market'){const names='buyGift purchaseGift buyMarketGift buyResaleGift buyFromMarket buyUniqueGift getMarketGifts getGiftMarket getMarket getResaleGifts getUniqueGifts getMarketplace getOwnedGifts getBotGifts getMyGifts getUserGifts getGiftsMarket marketBuy marketGifts getGiftOffers sendResaleGift transferGift upgradeGift giftUpgrade getUniqueGift getGiftCollections'.split(' '),out=[];
  for(const m of names){const r=await tg(m,{});const nf=r.error_code===404||/not found|unknown|no such/i.test(r.description||'');if(!nf)out.push('✓ '+m+' — '+String(r.description||'ok').slice(0,70))}
  return void say(id,out.length?'Найдено ('+out.length+' из '+names.length+'):\n'+out.join('\n'):'Методов покупки с маркета не найдено (проверено '+names.length+' названий).')}
 let x;if(t==='/nft'){const p=(D.nreq||[]).filter(w=>w.st==='pending');return void say(id,p.length?p.map(w=>`#${w.id} @${w.name} (${w.uid}) — ${IT[w.it][0]}`).join('\n'):'Нет заявок на подарки')}
 if((x=t.match(/^\/(given|rej)\s+(\d+)/))){const w=(D.nreq||[]).find(v=>v.id===+x[2]);if(!w||w.st!=='pending')return void say(id,'Заявка не найдена');
  const it=((D.users[w.uid]||{main:{}}).main.inv||[]).find(y=>y.u===w.u);
  if(x[1]==='given'){w.st='done';if(it)it.s='done';say(w.uid,`✅ Подарок «${IT[w.it][0]}» выдан`)}else{w.st='rejected';if(it)it.s='have';say(w.uid,`Выдача «${IT[w.it][0]}» отклонена, подарок вернулся в инвентарь`)}
  dirty=1;return void say(id,'Готово')}
 if(t==='/wd'){const p=D.wd.filter(w=>w.status==='pending');return void say(id,p.length?p.map(w=>`#${w.id} @${w.name} (${w.uid}) — ${w.amount} ★`).join('\n'):'Нет заявок')}
 if((x=t.match(/^\/(done|reject)\s+(\d+)/))){const w=D.wd.find(v=>v.id===+x[2]);if(!w||w.status!=='pending')return void say(id,'Заявка не найдена');
  if(x[1]==='done'){w.status='done';say(w.uid,`✅ Вывод ${w.amount} ★ выплачен`)}
  else{w.status='rejected';const u=D.users[w.uid];u.main.bal+=w.amount;u.wdn-=w.amount;D.tot.wd-=w.amount;say(w.uid,`Заявка на вывод ${w.amount} ★ отклонена, звёзды возвращены`)}
  dirty=1;return void say(id,'Готово')}
}
async function poll(){let off=0;for(;;){const r=await tg('getUpdates',{offset:off,timeout:25,allowed_updates:['message','pre_checkout_query']});
 if(!r.ok){await new Promise(x=>setTimeout(x,3000));continue}for(const up of r.result){off=up.update_id+1;try{await onUpdate(up)}catch(e){console.error(e)}}}}
load().then(()=>{if(!process.env.PAYOUT_PARAMS&&D.payoutParams)PAYOUT.params=D.payoutParams;
 server.listen(PORT,'0.0.0.0',async()=>{console.log('RubUp на порту '+PORT);tg('getMe',{}).then(r=>{if(r.ok&&r.result)CFG.bot=r.result.username});
  if(!BASE)return console.log('Нет WEBAPP_URL — webhook не установлен');
  const r=await tg('setWebhook',{url:BASE+HOOK,allowed_updates:['message','pre_checkout_query']});console.log('webhook:',r.ok,r.description||'');
  if(!r.ok){console.log('webhook не вышел — включаю polling');await tg('deleteWebhook');poll()}
  await tg('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть',web_app:{url:BASE}}})})
}).catch(e=>{console.error('Старт не удался:',e.message);process.exit(1)});
