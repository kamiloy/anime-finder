// @ts-nocheck
// FanJi 主代码 bundle — 从 index.html inline <script> 抽出
// preheat (window.fanji + localStorage 同步预热) 保留在 index.html 顶部 inline
import { playHeroPick } from './anim/shion-pick-hero';
import { enhanceReviewCards } from './anim/review-card-reveal';

// ===== 吉祥物：紫音 Shion（简约矢量风 · B站22娘同款）=====

function mascotImg(){
  return`<img class="mascot-art" src="shion-hero.png" alt="紫音"/>`;
}
function mascotImgSrc(){
  return'shion-hero.png';
}

// 骨架屏 HTML
function skeletonGrid(n=6){
  const card=`<div class="sk-card"><div class="sk-img"></div><div class="sk-body"><div class="sk-line"></div><div class="sk-line s"></div><div class="sk-line xs"></div></div></div>`;
  return`<div class="sk-grid">${Array(n).fill(card).join('')}</div>`;
}

// 吉祥物空状态
function mascotEmpty(text){
  return`<div class="mascot-block">${mascotImg()}<div class="speech-bubble">${text}</div></div>`;
}

// ===== 分享卡片 =====
let _shareBlob=null,_shareName='fanji-card.png',_shareText='';
const SHARE_FONT=(w,s)=>`${w} ${s}px "PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif`;

function loadImageEl(src,cross){
  return new Promise((res,rej)=>{
    const im=new Image();
    if(cross)im.crossOrigin='anonymous';
    im.onload=()=>res(im);
    im.onerror=()=>rej(new Error('img load fail'));
    im.src=src;
  });
}
// Bangumi 封面经 wsrv.nl 代理：附带 CORS 头，避免绘到 canvas 后被污染无法导出
function proxiedImg(url,w){
  const bare=url.replace(/^https?:\/\//,'');
  return`https://wsrv.nl/?url=${encodeURIComponent(bare)}&w=${w}&output=jpg&q=88`;
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function wrapLines(ctx,text,maxW,maxLines){
  const lines=[];let line='';
  for(const ch of [...text]){
    if(ctx.measureText(line+ch).width>maxW&&line){lines.push(line);line=ch;}
    else line+=ch;
  }
  if(line)lines.push(line);
  if(lines.length>maxLines){
    const kept=lines.slice(0,maxLines);
    let last=kept[maxLines-1];
    while(ctx.measureText(last+'…').width>maxW&&last.length)last=last.slice(0,-1);
    kept[maxLines-1]=last+'…';
    return kept;
  }
  return lines;
}

async function generateAnimeCard(d,entry){
  const W=1080,H=1480;
  const cv=document.createElement('canvas');
  cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#0a0814';ctx.fillRect(0,0,W,H);

  const coverUrl=(d.images?.large||d.images?.common||'').replace(/^http:/,'https:');
  let cover=null;
  if(coverUrl){try{cover=await loadImageEl(proxiedImg(coverUrl,520),true);}catch(e){cover=null;}}

  // 封面虚化氛围底
  if(cover){
    ctx.save();ctx.filter='blur(60px)';ctx.globalAlpha=0.6;
    const s=Math.max(W/cover.width,H/cover.height)*1.25;
    const cw=cover.width*s,ch=cover.height*s;
    ctx.drawImage(cover,(W-cw)/2,(H-ch)/2,cw,ch);
    ctx.restore();
  }
  // 暗化渐变保证文字可读
  const og=ctx.createLinearGradient(0,0,0,H);
  og.addColorStop(0,'rgba(10,8,20,0.55)');og.addColorStop(0.45,'rgba(10,8,20,0.8)');og.addColorStop(1,'rgba(10,8,20,0.97)');
  ctx.fillStyle=og;ctx.fillRect(0,0,W,H);
  const rg=ctx.createRadialGradient(W/2,180,0,W/2,180,680);
  rg.addColorStop(0,'rgba(168,85,247,0.3)');rg.addColorStop(1,'rgba(168,85,247,0)');
  ctx.fillStyle=rg;ctx.fillRect(0,0,W,H);

  // 清晰封面
  let coverBottom=120;
  if(cover){
    const boxW=440,boxH=560;
    const r=Math.min(boxW/cover.width,boxH/cover.height);
    const cw=cover.width*r,ch=cover.height*r,cx=(W-cw)/2,cy=104;
    ctx.save();ctx.shadowColor='rgba(168,85,247,0.55)';ctx.shadowBlur=55;ctx.shadowOffsetY=22;
    roundRect(ctx,cx,cy,cw,ch,28);ctx.fillStyle='#000';ctx.fill();ctx.restore();
    ctx.save();roundRect(ctx,cx,cy,cw,ch,28);ctx.clip();ctx.drawImage(cover,cx,cy,cw,ch);ctx.restore();
    ctx.save();roundRect(ctx,cx,cy,cw,ch,28);ctx.lineWidth=3;ctx.strokeStyle='rgba(168,85,247,0.55)';ctx.stroke();ctx.restore();
    coverBottom=cy+ch;
  }

  let y=coverBottom+78;
  ctx.textAlign='center';
  // 标题
  ctx.font=SHARE_FONT(700,62);ctx.fillStyle='#f0f0ff';
  for(const ln of wrapLines(ctx,d.name_cn||d.name||'',W-160,2)){ctx.fillText(ln,W/2,y);y+=78;}
  // 副标题
  const sub=[d.date?d.date.slice(0,4)+'年':'',d.eps?`全${d.eps}话`:''].filter(Boolean).join('   ·   ');
  if(sub){ctx.font=SHARE_FONT(400,30);ctx.fillStyle='#8888aa';y+=6;ctx.fillText(sub,W/2,y);y+=66;}else y+=12;

  // Bangumi 评分
  const bScore=d.rating?.score;
  if(bScore){
    ctx.font=SHARE_FONT(800,86);ctx.fillStyle='#f59e0b';ctx.fillText('★ '+bScore.toFixed(1),W/2,y);y+=48;
    const info=['Bangumi 评分',d.rating?.total?d.rating.total.toLocaleString()+' 人':'',d.rating?.rank?'排名 #'+d.rating.rank:''].filter(Boolean).join('   ·   ');
    ctx.font=SHARE_FONT(400,28);ctx.fillStyle='#8888aa';ctx.fillText(info,W/2,y);y+=70;
  }else{ctx.font=SHARE_FONT(600,40);ctx.fillStyle='#8888aa';ctx.fillText('暂无评分',W/2,y);y+=70;}

  // 我的评分 / 状态 胶囊
  const mine=[];
  if(entry?.rating)mine.push('我的评分 ★ '+entry.rating);
  if(entry?.status)mine.push(STATUS_ICONS[entry.status]+' '+STATUS_LABELS[entry.status]);
  if(mine.length){
    const txt=mine.join('     ·     ');
    ctx.font=SHARE_FONT(600,34);
    const ph=68,pw=ctx.measureText(txt).width+72,px=(W-pw)/2;
    ctx.save();roundRect(ctx,px,y-ph/2,pw,ph,ph/2);
    ctx.fillStyle='rgba(168,85,247,0.2)';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='rgba(168,85,247,0.55)';ctx.stroke();ctx.restore();
    ctx.fillStyle='#d8b4fe';ctx.textBaseline='middle';ctx.fillText(txt,W/2,y);ctx.textBaseline='alphabetic';
    y+=ph/2+50;
  }

  // 标签
  const tags=(d.tags||[]).slice(0,3).map(t=>t.name).filter(Boolean);
  if(tags.length){
    ctx.font=SHARE_FONT(500,28);
    const gap=18,ph=58;
    const ws=tags.map(t=>ctx.measureText(t).width+56);
    const total=ws.reduce((a,b)=>a+b,0)+gap*(tags.length-1);
    let x=(W-total)/2;
    ctx.textBaseline='middle';
    for(let i=0;i<tags.length;i++){
      roundRect(ctx,x,y,ws[i],ph,ph/2);
      ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='rgba(6,182,212,0.45)';ctx.stroke();
      ctx.fillStyle='#a8b4cf';ctx.textAlign='center';ctx.fillText(tags[i],x+ws[i]/2,y+ph/2);
      x+=ws[i]+gap;
    }
    ctx.textBaseline='alphabetic';
  }

  // 底部品牌栏 + 紫音
  const fy=H-218;
  ctx.strokeStyle='rgba(168,85,247,0.22)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(80,fy);ctx.lineTo(W-80,fy);ctx.stroke();
  ctx.textAlign='left';
  const lg=ctx.createLinearGradient(96,0,360,0);lg.addColorStop(0,'#a855f7');lg.addColorStop(1,'#06b6d4');
  ctx.fillStyle=lg;ctx.font=SHARE_FONT(800,52);ctx.fillText('FanJi 番迹',96,fy+86);
  ctx.fillStyle='#8888aa';ctx.font=SHARE_FONT(400,30);ctx.fillText('发现你的下一部好番',96,fy+138);
  try{
    const m=await loadImageEl(mascotImgSrc(),false);
    const mh=170,mw=mh*(m.width/m.height),mx=W-80-mw,my=fy+34;
    ctx.save();roundRect(ctx,mx,my,mw,mh,16);ctx.clip();ctx.drawImage(m,mx,my,mw,mh);ctx.restore();
    ctx.save();roundRect(ctx,mx,my,mw,mh,16);ctx.lineWidth=2;ctx.strokeStyle='rgba(168,85,247,0.45)';ctx.stroke();ctx.restore();
  }catch(e){}

  return cv;
}

// 战绩档案卡片
async function generateStatsCard(){
  const all=Object.values(getTracker());
  const W=1080,H=1480;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#0a0814';ctx.fillRect(0,0,W,H);
  let g=ctx.createRadialGradient(W/2,300,0,W/2,300,840);
  g.addColorStop(0,'rgba(168,85,247,0.32)');g.addColorStop(1,'rgba(168,85,247,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  g=ctx.createRadialGradient(W*0.85,H-220,0,W*0.85,H-220,560);
  g.addColorStop(0,'rgba(6,182,212,0.18)');g.addColorStop(1,'rgba(6,182,212,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // 紫音主视觉
  let topY=200;
  try{
    const m=await loadImageEl(mascotImgSrc(),false);
    const mh=300,mw=mh*(m.width/m.height),mx=(W-mw)/2,my=96;
    ctx.save();ctx.shadowColor='rgba(168,85,247,0.55)';ctx.shadowBlur=52;ctx.shadowOffsetY=18;
    roundRect(ctx,mx,my,mw,mh,24);ctx.fillStyle='#000';ctx.fill();ctx.restore();
    ctx.save();roundRect(ctx,mx,my,mw,mh,24);ctx.clip();ctx.drawImage(m,mx,my,mw,mh);ctx.restore();
    ctx.save();roundRect(ctx,mx,my,mw,mh,24);ctx.lineWidth=3;ctx.strokeStyle='rgba(168,85,247,0.5)';ctx.stroke();ctx.restore();
    topY=my+mh;
  }catch(e){}

  let y=topY+78;
  ctx.textAlign='center';
  ctx.font=SHARE_FONT(800,68);ctx.fillStyle='#f0f0ff';ctx.fillText('我的追番档案',W/2,y);y+=52;
  ctx.font=SHARE_FONT(400,30);ctx.fillStyle='#8888aa';ctx.fillText('FanJi 番迹 · 追番战绩',W/2,y);y+=72;

  // 2x2 数据格
  const watching=all.filter(e=>e.status==='watching').length;
  const watched=all.filter(e=>e.status==='watched').length;
  const wish=all.filter(e=>e.status==='wish').length;
  const cells=[{n:all.length,label:'追番总数',c:'#a855f7'},{n:watched,label:'看完',c:'#06b6d4'},{n:watching,label:'在看',c:'#3b82f6'},{n:wish,label:'想看',c:'#f59e0b'}];
  const gap=24,padX=80,cw=(W-padX*2-gap)/2,chh=168;
  for(let i=0;i<4;i++){
    const x=padX+(i%2)*(cw+gap),cy=y+(i/2|0)*(chh+gap);
    roundRect(ctx,x,cy,cw,chh,20);ctx.fillStyle='rgba(255,255,255,0.05)';ctx.fill();
    ctx.lineWidth=1.5;ctx.strokeStyle='rgba(168,85,247,0.25)';ctx.stroke();
    ctx.fillStyle=cells[i].c;ctx.font=SHARE_FONT(800,80);ctx.fillText(String(cells[i].n),x+cw/2,cy+96);
    ctx.fillStyle='#8888aa';ctx.font=SHARE_FONT(500,30);ctx.fillText(cells[i].label,x+cw/2,cy+140);
  }
  y+=chh*2+gap+72;

  // 平均打分
  const rated=all.map(e=>e.rating).filter(r=>r>0);
  if(rated.length){
    const avg=(rated.reduce((a,b)=>a+b,0)/rated.length).toFixed(1);
    ctx.font=SHARE_FONT(700,42);ctx.fillStyle='#f59e0b';ctx.fillText('平均打分 ★ '+avg,W/2,y);y+=70;
  }

  // 口味 Top3
  const tc={};
  all.forEach(e=>(e.anime?.tags||[]).forEach(t=>{const n=typeof t==='string'?t:t.name;if(!n||COMMON_TAGS.has(n))return;tc[n]=(tc[n]||0)+1;}));
  const top=Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
  if(top.length){
    ctx.font=SHARE_FONT(400,30);ctx.fillStyle='#8888aa';ctx.fillText('你的口味',W/2,y);y+=58;
    ctx.font=SHARE_FONT(600,34);
    const gp=18,ph=64,ws=top.map(t=>ctx.measureText(t).width+64);
    const total=ws.reduce((a,b)=>a+b,0)+gp*(top.length-1);
    let x=(W-total)/2;ctx.textBaseline='middle';
    for(let i=0;i<top.length;i++){
      roundRect(ctx,x,y,ws[i],ph,ph/2);ctx.fillStyle='rgba(168,85,247,0.18)';ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle='rgba(168,85,247,0.5)';ctx.stroke();
      ctx.fillStyle='#d8b4fe';ctx.textAlign='center';ctx.fillText(top[i],x+ws[i]/2,y+ph/2);
      x+=ws[i]+gp;
    }
    ctx.textBaseline='alphabetic';
  }

  // 品牌栏
  const fy=H-150;ctx.textAlign='center';
  const lg=ctx.createLinearGradient(W/2-200,0,W/2+200,0);lg.addColorStop(0,'#a855f7');lg.addColorStop(1,'#06b6d4');
  ctx.fillStyle=lg;ctx.font=SHARE_FONT(800,48);ctx.fillText('FanJi 番迹',W/2,fy+40);
  ctx.fillStyle='#8888aa';ctx.font=SHARE_FONT(400,28);ctx.fillText('发现你的下一部好番 · '+new Date().toISOString().slice(0,10).replace(/-/g,'.'),W/2,fy+86);
  return cv;
}

// 生成 → 弹预览（单番卡 / 战绩卡共用）
async function presentCard(canvasPromise,name,text){
  const bg=document.getElementById('shareBg');
  const prev=document.getElementById('sharePreview');
  prev.innerHTML='<div class="message"><div class="loading-dots"><span></span><span></span><span></span></div></div>';
  bg.classList.add('open');
  _shareBlob=null;
  try{
    const cv=await canvasPromise;
    await new Promise((res,rej)=>cv.toBlob(b=>{if(b){_shareBlob=b;res();}else rej(new Error('导出失败'));},'image/png'));
    const url=URL.createObjectURL(_shareBlob);
    prev.innerHTML=`<img src="${url}" alt="分享卡片"/>`;
    _shareName=name;_shareText=text;
  }catch(e){
    console.error('share card error',e);
    prev.innerHTML='<div class="message" style="padding:2rem">卡片生成失败，请重试</div>';
  }
}

function openShareCard(d){
  const name=(d.name_cn||d.name||'card').replace(/[\\/:*?"<>|]/g,'').slice(0,20);
  presentCard(generateAnimeCard(d,getEntry(d.id)),`fanji-${name}.png`,`【${d.name_cn||d.name}】— 我在 FanJi 番迹追番`);
}

function openStatsCard(){
  if(!Object.keys(getTracker()).length){showToast('先追几部番再来生成战绩卡吧～');return;}
  presentCard(generateStatsCard(),`fanji-战绩-${new Date().toISOString().slice(0,10)}.png`,'这是我的追番战绩 — FanJi 番迹');
}

async function openWatchUrl(url){
  try{
    if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Browser){
      await window.Capacitor.Plugins.Browser.open({url,presentationStyle:'fullscreen'});
      return;
    }
  }catch(e){}
  window.open(url,'_blank','noopener,noreferrer');
}

// ===== 常量 =====
const PAGE=20;
const TRACKER_KEY='fanji_tracker_v2';
const OLD_FAV_KEY='fanji_favorites';
const IOS_TIP_KEY='fanji_ios_tip_dismissed';
const STATUS_LABELS={wish:'想看',watching:'在看',watched:'看完',hold:'搁置',dropped:'放弃'};
const STATUS_ICONS={wish:'🔖',watching:'▶',watched:'✓',hold:'⏸',dropped:'✕'};

let currentView='hot';
let hotState={page:1,tag:'',search:'',total:0,year:'',airing:false};
let rankState={page:1,total:0,year:'',airing:false};
let currentDetailAnime=null;
let deferredInstallPrompt=null;
let myTab='all';

// ===== API =====
let USE_WORKER_API=true;
let workerFailStreak=0;
const WORKER_FAIL_LIMIT=3;
const API_BASE='https://fanji-api.pages.dev';

// Community namespace — external modules 通过此命名空间与主应用通信
const BGM_BASE='https://api.bgm.tv';

// 图片源：Bangumi 图床 lain.bgm.tv 在国内被阻断，经 CF 边缘代理（pages.dev 国内可达）；非 lain 链接原样返回
function imgSrc(url){
  if(!url)return'';
  if(url.startsWith(API_BASE+'/api/img'))return url; // 已代理，幂等返回，避免重复包裹
  const s=url.replace(/^http:/,'https:');
  return s.includes('lain.bgm.tv')?API_BASE+'/api/img?u='+encodeURIComponent(s):s;
}
// 图片加载完成：淡入 + 停掉所在容器的骨架微光
function imgLoaded(el){el.classList.add('loaded');const w=el.closest('.card-img-wrap,.char-thumb,.work-cover');if(w)w.classList.add('img-done');}

function apiFetch(path,opts={}){
  const url=API_BASE+path;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),18000);
  const p=opts.params?fetch(url+(url.includes('?')?'&':'?')+new URLSearchParams(opts.params).toString(),{signal:ctrl.signal})
    :opts.body?fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(opts.body),signal:ctrl.signal})
    :fetch(url,{signal:ctrl.signal});
  // 成功即重置失败计数
  return p.then(r=>r.json()).then(j=>{workerFailStreak=0;return j;}).finally(()=>clearTimeout(timer));
}

// 仅当核心请求连续失败 WORKER_FAIL_LIMIT 次才整体降级，避免国内一次慢请求(超时)毒死整会话
function killWorker(){if(++workerFailStreak>=WORKER_FAIL_LIMIT)USE_WORKER_API=false;}

// 预取：用户按下卡片时静默预热详情+角色到 SW 缓存，打开抽屉更快。仅交互触发、每卡一次、忽略结果
const _prefetched=new Set();
function prefetchAnime(id){
  if(!USE_WORKER_API||id==null||_prefetched.has(id))return;
  _prefetched.add(id);
  apiFetch('/api/anime/'+id).catch(()=>{});
  apiFetch('/api/anime/'+id+'/characters').catch(()=>{});
}

function getExtraFilters(state){
  const extra={};
  if(state.year)extra.air_date=['>='+state.year+'-01-01','<='+state.year+'-12-31'];
  return extra;
}

async function fetchHot(o,extra){
  if(USE_WORKER_API&&!(extra||{}).air_date){
    try{
      const p={sort:'heat',page:Math.floor(o/PAGE)+1,limit:PAGE};
      const d=await apiFetch('/api/anime',{params:p});
      return {data:d.data||[],total:d.total||0};
    }catch(e){killWorker();}
  }
  return fetchHotLegacy(o,extra);
}
function fetchHotLegacy(o,extra){
  return fetch(BGM_BASE+'/v0/search/subjects?limit='+PAGE+'&offset='+o,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:'',sort:'heat',filter:{type:[2],...extra}})}).then(r=>r.json());
}

async function fetchTag(t,o,extra){
  if(USE_WORKER_API){
    try{
      const p={sort:'heat',tag:t,page:Math.floor(o/PAGE)+1,limit:PAGE};
      const d=await apiFetch('/api/anime',{params:p});
      return {data:d.data||[],total:d.total||0};
    }catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/v0/search/subjects?limit='+PAGE+'&offset='+o,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:'',sort:'heat',filter:{type:[2],tag:[t],...extra}})}).then(r=>r.json());
}

async function fetchSearch(q,o,extra){
  if(USE_WORKER_API){
    try{
      const p={q,page:Math.floor(o/PAGE)+1,limit:PAGE};
      const d=await apiFetch('/api/anime/search',{params:p});
      return {data:d.data||[],total:d.total||0};
    }catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/v0/search/subjects?limit='+PAGE+'&offset='+o,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:q,filter:{type:[2],...extra}})}).then(r=>r.json());
}

async function fetchRanking(o,extra){
  if(USE_WORKER_API&&!(extra||{}).air_date){
    try{
      const p={sort:'rank',page:Math.floor(o/PAGE)+1,limit:PAGE};
      const d=await apiFetch('/api/anime',{params:p});
      return {data:d.data||[],total:d.total||0};
    }catch(e){killWorker();}
  }
  return fetchRankingLegacy(o,extra);
}
function fetchRankingLegacy(o,extra){
  return fetch(BGM_BASE+'/v0/search/subjects?limit='+PAGE+'&offset='+o,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:'',sort:'rank',filter:{type:[2],...extra}})}).then(r=>r.json());
}

async function fetchCalendar(){
  if(USE_WORKER_API){
    try{
      const d=await apiFetch('/api/calendar');
      const weekNames=[{id:1,cn:'星期一',en:'Monday',ja:'月曜日'},{id:2,cn:'星期二',en:'Tuesday',ja:'火曜日'},{id:3,cn:'星期三',en:'Wednesday',ja:'水曜日'},{id:4,cn:'星期四',en:'Thursday',ja:'木曜日'},{id:5,cn:'星期五',en:'Friday',ja:'金曜日'},{id:6,cn:'星期六',en:'Saturday',ja:'土曜日'},{id:7,cn:'星期日',en:'Sunday',ja:'日曜日'}];
      return weekNames.map((w,i)=>({weekday:w,items:d.data[i]||[]}));
    }catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/calendar').then(r=>r.json());
}

const fetchDetail=async id=>{
  if(USE_WORKER_API){
    try{const d=await apiFetch('/api/anime/'+id);return d.data||d;}
    catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/v0/subjects/'+id).then(r=>r.json());
};

async function fetchTagSubjects(tag){
  if(USE_WORKER_API){
    try{
      const d=await apiFetch('/api/anime',{params:{tag,limit:20,sort:'rank'}});
      return {data:d.data||[]};
    }catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/v0/subjects?type=2&tag='+encodeURIComponent(tag)+'&limit=20&offset=0&sort=rank').then(r=>r.json());
}
async function fetchRelated(id){
  if(USE_WORKER_API){
    try{const d=await apiFetch('/api/anime/'+id+'/related');return d.data||[];}
    catch(e){killWorker();}
  }
  return fetch(BGM_BASE+'/v0/subjects/'+id+'/subjects').then(r=>r.json());
}
async function fetchCharacters(id){
  if(USE_WORKER_API){
    try{const d=await apiFetch('/api/anime/'+id+'/characters');return d.data||[];}
    catch(e){/* 角色失败不杀 worker，仅本功能降级 */}
  }
  // fallback：直连 Bangumi（仅 fallback 模式下 id 才是 bangumi id）
  try{
    const raw=await fetch(BGM_BASE+'/v0/subjects/'+id+'/characters').then(r=>r.json());
    return (Array.isArray(raw)?raw:[]).map(c=>({
      id:c.id,name:c.name||'',relation:c.relation||'',
      image:imgSrc((c.images||{}).medium||(c.images||{}).grid||''),
      actors:(c.actors||[]).map(a=>({id:a.id,name:a.name||'',image:imgSrc((a.images||{}).medium||(a.images||{}).grid||'')}))
    }));
  }catch(e){return [];}
}
async function fetchPerson(personId){
  if(USE_WORKER_API){
    try{const d=await apiFetch('/api/person/'+personId);if(d.ok!==false)return d.data||null;}
    catch(e){/* 同上，仅本功能降级 */}
  }
  try{
    const [p,chars]=await Promise.all([
      fetch(BGM_BASE+'/v0/persons/'+personId).then(r=>r.json()),
      fetch(BGM_BASE+'/v0/persons/'+personId+'/characters').then(r=>r.json())
    ]);
    const seen=new Set(),works=[];
    for(const c of (Array.isArray(chars)?chars:[])){
      if(c.subject_type!==2||!c.subject_id||seen.has(c.subject_id))continue;
      seen.add(c.subject_id);
      works.push({
        bangumi_id:c.subject_id,name:c.subject_name||'',name_cn:c.subject_name_cn||'',
        char_name:c.name||'',relation:c.staff||'',app_id:null,score:0,
        image:imgSrc((c.images||{}).medium||(c.images||{}).grid||'')
      });
    }
    return {
      id:p.id,name:p.name||'',
      image:imgSrc((p.images||{}).medium||(p.images||{}).grid||''),
      career:Array.isArray(p.career)?p.career.join(' / '):'',
      works:works.slice(0,48)
    };
  }catch(e){return null;}
}

// ===== 追番状态系统 =====
function getTracker(){try{return JSON.parse(localStorage.getItem(TRACKER_KEY)||'{}')}catch(e){return{}}}
function saveTracker(t){
  try{localStorage.setItem(TRACKER_KEY,JSON.stringify(t))}
  catch(e){showToast('存储空间不足！请导出数据后清理一些番剧');throw e}
}
function getEntry(id){return getTracker()[id]||null}

function setStatus(anime,status,progress,rating){
  const t=getTracker();
  if(!status){
    delete t[anime.id];
  }else{
    const existing=t[anime.id];
    const isWatched=status==='watched'||status==='dropped';
    const wasWatched=existing&&(existing.status==='watched'||existing.status==='dropped');
    t[anime.id]={
      status,
      progress:progress!=null?progress:(existing?.progress||0),
      rating:rating!=null?rating:(existing?.rating||0),
      addedAt:existing?.addedAt||Date.now(),
      updatedAt:Date.now(),
      completedAt:isWatched?(existing?.completedAt||Date.now()):(wasWatched?null:existing?.completedAt),
      anime:{id:anime.id,name:anime.name,name_cn:anime.name_cn,images:anime.images,score:anime.rating?.score||anime.score,date:anime.date,tags:anime.tags,eps:anime.eps}
    };
  }
  saveTracker(t);
}

function migrateFromFavorites(){
  const old=localStorage.getItem(OLD_FAV_KEY);
  if(!old)return;
  const tracker=getTracker();
  if(Object.keys(tracker).length>0)return;
  try{
    const favs=JSON.parse(old);
    if(!Array.isArray(favs)||!favs.length)return;
    const newT={};
    favs.forEach(a=>{
      newT[a.id]={status:'wish',progress:0,addedAt:Date.now(),updatedAt:Date.now(),
        anime:{id:a.id,name:a.name,name_cn:a.name_cn,images:a.images,score:a.rating?.score||a.score,date:a.date,tags:a.tags}};
    });
    saveTracker(newT);
    showToast(`已迁移 ${favs.length} 部收藏到番单 ✨`);
  }catch(e){}
}

// ===== 徽章 & 状态图标 =====
function getTrackIcon(id){
  const e=getEntry(id);
  if(!e)return{icon:'♡',cls:''};
  const icons={wish:'🔖',watching:'▶',watched:'✓',hold:'⏸',dropped:'✕'};
  const clss={wish:'s-wish',watching:'s-watching',watched:'s-watched',hold:'s-hold',dropped:'s-dropped'};
  return{icon:icons[e.status],cls:clss[e.status]};
}

function updateMyBadge(){
  const watching=Object.values(getTracker()).filter(e=>e.status==='watching').length;
  const b=document.getElementById('bnBadge');
  b.textContent=watching;
  b.style.display=watching>0?'inline-block':'none';
}

function updateAllCardBtns(id){
  document.querySelectorAll(`.fav-btn[data-fid="${id}"]`).forEach(btn=>{
    const{icon,cls:sc}=getTrackIcon(id);
    btn.innerHTML=icon;
    btn.className=`fav-btn ${sc}`;
  });
}

// ===== 卡片渲染 =====
function timeAgo(ts){
  if(!ts)return'';
  const d=(Date.now()-ts)/1000;
  if(d<60)return'刚刚';
  if(d<3600)return Math.floor(d/60)+'分钟前';
  if(d<86400)return Math.floor(d/3600)+'小时前';
  if(d<2592000)return Math.floor(d/86400)+'天前';
  return Math.floor(d/2592000)+'个月前';
}
function cardHtml(a,opts={}){
  const img=imgSrc(a.images?.common||a.images?.medium||a.images?.grid||'');
  const s=a.rating?.score||a.score;
  const score=s?`★ ${s.toFixed(1)}`:'暂无';
  const cls=s?'card-score':'card-score none';
  const year=a.date?a.date.slice(0,4):'';
  const tags=(a.tags||[]).slice(0,2).map(t=>`<span class="tag-pill">${typeof t==='string'?t:t.name}</span>`).join('');
  const{icon,cls:statusCls}=getTrackIcon(a.id);
  let rankBadge='';
  if(opts.rank){
    const rc=opts.rank===1?'gold':opts.rank===2?'silver':opts.rank===3?'bronze':'';
    rankBadge=`<div class="rank-badge ${rc}">#${opts.rank}</div>`;
  }
  let metaExtra='';
  if(opts.userRating)metaExtra=`<span class="card-user-rating">⭐ ${opts.userRating}</span>`;
  if(opts.timeAgo)metaExtra+=`<span class="card-time">${opts.timeAgo}</span>`;
  return`<div class="card" data-id="${a.id}">
    <div class="card-img-wrap">
      ${rankBadge}
      <button class="fav-btn ${statusCls}" data-fid="${a.id}">${icon}</button>
      <img src="${img}" alt="" loading="lazy" class="img-fade" onload="imgLoaded(this)"/>
    </div>
    <div class="card-body">
      <div class="card-title">${a.name_cn||a.name}</div>
      <div class="card-meta"><span class="${cls}">${score}</span><span class="card-year">${year}</span>${metaExtra}</div>
      <div class="card-tags">${tags}</div>
    </div>
  </div>`;
}

function addRipple(el){
  el.classList.add('ripple-wrap');
  el.addEventListener('pointerdown',e=>{
    const r=el.getBoundingClientRect();
    const d=document.createElement('span');
    d.className='ripple-dot';
    const s=Math.max(r.width,r.height);
    d.style.cssText=`width:${s}px;height:${s}px;left:${e.clientX-r.left-s/2}px;top:${e.clientY-r.top-s/2}px`;
    el.appendChild(d);
    d.addEventListener('animationend',()=>d.remove());
  },{passive:true});
}

function bindCards(grid,items){
  grid.querySelectorAll('.card').forEach((c,i)=>{
    c.style.animationDelay=`${i*0.05}s`;
    addRipple(c);
    c.addEventListener('pointerdown',()=>prefetchAnime(items[i]&&items[i].id),{passive:true,once:true});
    c.addEventListener('click',e=>{
      if(e.target.closest('.fav-btn'))return;
      openDrawer(items[i],cardOrigin(c));
    });
  });
  grid.querySelectorAll('.fav-btn').forEach(b=>{
    b.addEventListener('click',e=>{
      e.stopPropagation();
      const id=parseInt(b.dataset.fid);
      const a=items.find(x=>x.id===id);
      if(!a)return;
      const entry=getEntry(id);
      if(!entry){
        setStatus(a,'wish');
        shionReact('wish');
      }else if(entry.status==='wish'){
        const undoEntry=getEntry(id);
        const undoAnime=a;
        setStatus(a,null);
        showToast('已移除',()=>{
          setStatus(undoAnime,undoEntry.status,undoEntry.progress);
          updateMyBadge();
          updateAllCardBtns(id);
          if(currentView==='my')renderMyPage();
          showToast('已恢复');
        });
      }else{
        showToast(`「${STATUS_LABELS[entry.status]}」· 打开详情修改`);
        return;
      }
      if(navigator.vibrate)navigator.vibrate(10);
      updateMyBadge();
      updateAllCardBtns(id);
      if(currentView==='my')renderMyPage();
    });
  });
}

// ===== 翻页 =====
function renderPagination(containerId,state,onPage){
  const pg=document.getElementById(containerId);
  const total=Math.min(Math.ceil(state.total/PAGE),15);
  if(total<=1){pg.innerHTML='';return;}
  const ps=[];
  for(let i=Math.max(1,state.page-2);i<=Math.min(total,state.page+2);i++)ps.push(i);
  pg.innerHTML=[
    state.page>1?`<button class="page-btn" data-p="${state.page-1}">←</button>`:'',
    ...ps.map(p=>`<button class="page-btn${p===state.page?' active':''}" data-p="${p}">${p}</button>`),
    state.page<total?`<button class="page-btn" data-p="${state.page+1}">→</button>`:''
  ].join('');
  pg.querySelectorAll('[data-p]').forEach(b=>b.addEventListener('click',()=>{
    onPage(parseInt(b.dataset.p));
    window.scrollTo({top:0,behavior:'smooth'});
  }));
}

// ===== 热门 =====
async function loadHot(){
  document.getElementById('hotGrid').innerHTML=skeletonGrid(6);
  document.getElementById('hotPagination').innerHTML='';
  const offset=(hotState.page-1)*PAGE;
  const extra=getExtraFilters(hotState);
  try{
    let data;
    if(hotState.search)data=await fetchSearch(hotState.search,offset,extra);
    else if(hotState.tag)data=await fetchTag(hotState.tag,offset,extra);
    else data=await fetchHot(offset,extra);
    const items=data.data||data.list||[];
    hotState.total=data.total||items.length;
    document.getElementById('hotCount').textContent=`共 ${hotState.total} 部`;
    let ht=hotState.search?`"${hotState.search}"`:hotState.tag?`${hotState.tag} 番剧`:'综合热门番剧';
    if(hotState.year)ht+=` · ${hotState.year}年`;
    document.getElementById('hotTitle').textContent=ht;
    const g=document.getElementById('hotGrid');
    if(!items.length){g.innerHTML=mascotEmpty('没有找到相关动漫…<br/>换个关键词试试？');return;}
    g.innerHTML=items.map(a=>cardHtml(a)).join('');
    bindCards(g,items);
    renderPagination('hotPagination',hotState,p=>{hotState.page=p;loadHot();});
  }catch(e){
    document.getElementById('hotGrid').innerHTML=mascotEmpty('网络开小差了…<br/>刷新再试一次！');
  }
}

// ===== 紫音今日钦点（首屏 co-host editorial 卡）=====
function verdictOf(s){
  if(s>=9)return{t:'👑 封神',c:'god'};
  if(s>=8.3)return{t:'强推',c:'hot'};
  if(s>=7.8)return{t:'值得追',c:'good'};
  return{t:'紫音之选',c:'good'};
}
function renderHeroFeature(a){
  const el=document.getElementById('heroFeature');
  if(!el||!a)return;
  const s=a.rating?.score||a.score||0;
  const year=a.date?a.date.slice(0,4):'';
  const v=verdictOf(s);
  document.getElementById('hfCover').src=imgSrc(a.images?.common||a.images?.medium||a.images?.grid||'');
  document.getElementById('hfTitle').textContent=a.name_cn||a.name;
  document.getElementById('hfMeta').innerHTML=`<span class="hf-verdict ${v.c}">${v.t}</span>`+(s?`<span class="hf-score">★ ${s.toFixed(1)}</span>`:'')+(year?`<span class="hf-year">${year}</span>`:'');
  document.getElementById('hfReview').textContent=(a.shion_review||'').trim();
  el._anime=a;
  el.hidden=false;
  // GSAP 招牌入场：封面 spring + 战力胶囊 弹入 + 标题/锐评 SplitText 逐字
  requestAnimationFrame(()=>playHeroPick(el));
}
async function loadHeroFeature(){
  const el=document.getElementById('heroFeature');
  if(!el)return;
  try{
    const pool=await fetchDiscover('c_pick',{limit:24});
    if(!pool||!pool.length){el.hidden=true;return;}
    renderHeroFeature(pool[Math.floor(Date.now()/864e5)%pool.length]);
  }catch(e){el.hidden=true;}
}
document.getElementById('heroFeature')?.addEventListener('click',function(){if(this._anime)openDrawer(this._anime,cardOrigin(this));});

// ===== 排行 =====
async function loadRanking(){
  document.getElementById('rankGrid').innerHTML=skeletonGrid(6);
  document.getElementById('rankPagination').innerHTML='';
  const offset=(rankState.page-1)*PAGE;
  try{
    const extra=getExtraFilters(rankState);
    const data=await fetchRanking(offset,extra);
    const items=data.data||data.list||[];
    rankState.total=data.total||items.length;
    document.getElementById('rankCount').textContent=`共 ${rankState.total} 部`;
    const g=document.getElementById('rankGrid');
    if(!items.length){g.innerHTML='<div class="message">暂无数据</div>';return;}
    g.innerHTML=items.map((a,i)=>cardHtml(a,{rank:offset+i+1})).join('');
    bindCards(g,items);
    renderPagination('rankPagination',rankState,p=>{rankState.page=p;loadRanking();});
  }catch(e){
    document.getElementById('rankGrid').innerHTML='<div class="message">加载失败</div>';
  }
}

// ===== 发现：心情/场景找番 =====
const DISCOVER_GROUPS=[
  {title:'跟着心情',icon:'💜',sub:'今天想要什么感觉',items:[
    {key:'m_heal', emoji:'🌿',label:'治愈',   intro:'被生活搓圆了？来点温的，专治班味和内耗。'},
    {key:'m_cry',  emoji:'🔪',label:'致郁刀',  intro:'想哭一场就对了，纸巾自备，别怪我没提醒。'},
    {key:'m_blood',emoji:'🔥',label:'热血燃',  intro:'肾上腺素拉满，看完想原地起立那种。'},
    {key:'m_sweet',emoji:'🍬',label:'恋爱糖',  intro:'甜到齁，单身狗自备血糖仪。'},
    {key:'m_funny',emoji:'🤪',label:'沙雕',   intro:'不用动脑，笑出腹肌，纯解压。'},
    {key:'m_chill',emoji:'🍜',label:'下饭',   intro:'边吃边看刚好，无脑爽，关脑子看。'},
    {key:'m_emo',  emoji:'🌌',label:'EMO后劲', intro:'看完缓不过来，后劲贼大，慎入。'},
    {key:'m_scene',emoji:'✨',label:'名场面',  intro:'作画演出封神，光这些就值回票价。'},
    {key:'m_brain',emoji:'🧠',label:'烧脑',   intro:'智商不在线别点，费脑子但上头。'},
  ]},
  {title:'挑个场合',icon:'⏳',sub:'看你有多少时间',items:[
    {key:'s_oneseason',emoji:'📺',label:'一季补完',intro:'13集内，周末就能刷完，零负担。'},
    {key:'s_airing',   emoji:'🟢',label:'当季新番',intro:'正在更新，追了好和人聊。'},
    {key:'s_long',     emoji:'🏔️',label:'长篇大坑',intro:'40集起跳，入坑需谨慎。'},
    {key:'s_classic',  emoji:'🏆',label:'老番补课',intro:'欠了多年的神作，该还债了。'},
  ]},
  {title:'紫音带你挖宝',icon:'🔮',sub:'别人懒得给你看的',accent:true,items:[
    {key:'t_gem',          emoji:'💎',label:'冷门遗珠',     intro:'分高人少，识货的才点得开。'},
    {key:'t_controversial',emoji:'⚔️',label:'争议之作',     intro:'要么封神要么劝退，敢不敢赌？'},
    {key:'t_trap',         emoji:'🚧',label:'避雷·名不副实',intro:'火归火，紫音劝你三思再入坑。'},
  ]},
  {title:'紫音钦点',icon:'👑',sub:'她亲自翻的牌',accent:true,items:[
    {key:'c_pick',  emoji:'💜',label:'紫音私藏',intro:'我私心收着的，闭眼入不亏。'},
    {key:'c_weekly',emoji:'📜',label:'本周锐评',intro:'这周翻到的，听我两句再决定。',render:'review',limit:8,seed:true},
  ]},
];
const DISCOVER_MAP=Object.fromEntries(DISCOVER_GROUPS.flatMap(g=>g.items.map(it=>[it.key,it])));

function weekSeed(){return Math.floor(Date.now()/6.048e8);} // 周序号(自epoch)，本周锐评的确定性轮换种子
async function fetchDiscover(key,opts={}){
  if(USE_WORKER_API){
    try{
      const params={key,limit:opts.limit||30};
      if(opts.seed!=null)params.seed=opts.seed;
      const d=await apiFetch('/api/discover',{params});
      return d.data||[];
    }catch(e){killWorker();}
  }
  return null; // 发现依赖自建 D1（mood_tags/评分分布），无 Bangumi 等价回退
}
// 锐评卡：封面 + 大字紫音锐评（本周锐评专用编辑版式，适合截图）
function reviewCardHtml(a){
  const img=imgSrc(a.images?.common||a.images?.medium||a.images?.grid||'');
  const s=a.rating?.score||a.score;
  const score=s?`★ ${s.toFixed(1)}`:'';
  const year=a.date?a.date.slice(0,4):'';
  const review=(a.shion_review||'').trim();
  return`<div class="review-card" data-id="${a.id}">
    <div class="rc-cover-wrap"><img class="rc-cover img-fade" src="${img}" loading="lazy" onload="imgLoaded(this)" alt=""/></div>
    <div class="rc-body">
      <div class="rc-title">${a.name_cn||a.name}</div>
      <div class="rc-meta">${score?`<span class="rc-score">${score}</span>`:''}${year?`<span class="rc-year">${year}</span>`:''}</div>
      ${review?`<div class="rc-review"><span class="rc-quote">“</span>${esc(review)}</div>`:''}
    </div>
  </div>`;
}
function bindReviewCards(box,items){
  box.querySelectorAll('.review-card').forEach((c,i)=>{
    // CSS 入场 stagger 仍保留作为 GSAP 关闭时的降级（prefers-reduced-motion）
    c.style.animationDelay=`${i*0.06}s`;
    addRipple(c);
    c.addEventListener('pointerdown',()=>prefetchAnime(items[i]&&items[i].id),{passive:true,once:true});
    c.addEventListener('click',()=>openDrawer(items[i],cardOrigin(c)));
  });
  // GSAP ScrollTrigger 进视图触发：封面 scale + 锐评 SplitText 逐字 reveal + quote sweep
  enhanceReviewCards(box);
}

let _discRendered=false;
function loadDiscover(){
  if(_discRendered)return;
  const wrap=document.getElementById('discoverLanding');
  wrap.innerHTML=DISCOVER_GROUPS.map(g=>{
    const tiles=g.items.map(it=>g.accent
      ?`<button class="disc-tile gem" data-key="${it.key}"><span class="disc-tile-emoji">${it.emoji}</span><span class="disc-tile-body"><span class="disc-tile-label">${it.label}</span><span class="disc-tile-intro">${it.intro}</span></span></button>`
      :`<button class="disc-tile" data-key="${it.key}"><span class="disc-tile-emoji">${it.emoji}</span><span class="disc-tile-label">${it.label}</span><span class="disc-tile-intro">${it.intro}</span></button>`
    ).join('');
    return`<div class="disc-section"><div class="disc-section-head"><span class="disc-section-icon">${g.icon}</span><span class="disc-section-title">${g.title}</span><span class="disc-section-sub">${g.sub}</span></div><div class="disc-tiles${g.accent?' wide':''}">${tiles}</div></div>`;
  }).join('');
  wrap.querySelectorAll('.disc-tile').forEach((t,i)=>{
    t.style.animationDelay=`${i*0.03}s`;
    addRipple(t);
    t.addEventListener('click',()=>openMood(t.dataset.key));
  });
  _discRendered=true;
}

async function openMood(key){
  const it=DISCOVER_MAP[key];
  if(!it)return;
  document.getElementById('discoverLanding').hidden=true;
  document.getElementById('discoverResults').hidden=false;
  document.getElementById('discResultHead').innerHTML=`<span class="disc-result-emoji">${it.emoji}</span><div class="disc-result-txt"><div class="disc-result-label">${it.label}</div><div class="disc-result-intro"><span class="disc-shion-tag">紫音</span>${it.intro}</div></div>`;
  const isReview=it.render==='review';
  const g=document.getElementById('discGrid');
  g.className=isReview?'review-list':'grid';
  g.innerHTML=skeletonGrid(6);
  window.scrollTo({top:0,behavior:'smooth'});
  const data=await fetchDiscover(key,{limit:it.limit,seed:it.seed?weekSeed():null});
  if(data===null){g.innerHTML=mascotEmpty('发现功能要联网才好使…<br/>等会儿再来？');return;}
  if(!data.length){g.innerHTML=mascotEmpty('这个心情下暂时没挖到番…<br/>换一个试试？');return;}
  if(isReview){g.innerHTML=data.map(reviewCardHtml).join('');bindReviewCards(g,data);}
  else{g.innerHTML=data.map(a=>cardHtml(a)).join('');bindCards(g,data);}
}
function resetDiscover(){
  document.getElementById('discoverResults').hidden=true;
  document.getElementById('discoverLanding').hidden=false;
}
document.getElementById('discBack').addEventListener('click',()=>{resetDiscover();window.scrollTo({top:0,behavior:'smooth'});});

// ===== 新番 =====
// ===== 今日在追更新提醒 =====
let lastCalendar=null;
const SHION_UPDATE_LINES=[
  '哼，你追的番今天更新了，别又拖到忘了。',
  '更新日到了，紫音可没有提醒第二遍的习惯。',
  '今天有得看了，看完记得回来标进度——别装死。',
  '又更新了，准时蹲点的样子还挺像样的嘛。',
  '别愣着，你的番在等你呢。看完再走。',
  '更新了哦。我才不是特地提醒你的，顺便而已。',
  '今天该追的别落下，紫音盯着呢。'
];
function getTodayWatching(cal){
  if(!cal||!USE_WORKER_API)return[];
  const today=new Date().getDay()||7;
  const day=cal.find(d=>d.weekday&&d.weekday.id===today);
  const items=(day&&day.items)||[];
  const tracker=getTracker();
  return items.filter(a=>{const e=tracker[a.id];return e&&e.status==='watching';});
}
// 集数级更新：懒拉本篇集数，按 airdate<=今天(本地) 算"已更新第N集"（仅在追且今天更新的番，量小）
async function fetchEpisodes(id){
  if(!USE_WORKER_API)return[];
  try{const d=await apiFetch('/api/anime/'+id+'/episodes');return (d&&d.ok&&Array.isArray(d.data))?d.data:[];}catch(e){return[];}
}
function airedEp(eps){
  const d=new Date();
  const today=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let maxEp=0;
  for(const e of eps){if(e.airdate&&e.airdate<=today){const n=e.ep||0;if(n>maxEp)maxEp=n;}}
  return maxEp;
}
function renderTodayWatching(cal){
  const box=document.getElementById('todayWatchingBanner');
  if(!box)return;
  const list=getTodayWatching(cal);
  if(!list.length){box.hidden=true;box.innerHTML='';return;}
  const line=SHION_UPDATE_LINES[new Date().getDay()%SHION_UPDATE_LINES.length];
  const cards=list.map(a=>{
    const img=imgSrc(a.images?.common||a.images?.medium||a.images?.grid||'');
    return`<button class="tw-card" data-id="${a.id}"><img src="${img}" loading="lazy" alt="" class="img-fade" onload="imgLoaded(this)"/><span class="tw-ep" id="twep-${a.id}"></span><span class="tw-card-title">${a.name_cn||a.name}</span></button>`;
  }).join('');
  box.innerHTML=`<div class="tw-head"><span class="tw-icon">🔔</span><span class="tw-title">你在追的 <b>${list.length}</b> 部今天更新</span><span class="tw-shion">${line}</span></div><div class="tw-strip">${cards}</div>`;
  box.hidden=false;
  box.querySelectorAll('.tw-card').forEach(c=>{
    const id=parseInt(c.dataset.id);
    const a=list.find(x=>x.id===id);
    c.addEventListener('pointerdown',()=>prefetchAnime(id),{passive:true,once:true});
    c.addEventListener('click',()=>{if(a)openDrawer(a,cardOrigin(c));});
  });
  // 异步填"已更新第N集"徽标
  list.forEach(async a=>{
    const ep=airedEp(await fetchEpisodes(a.id));
    if(ep>0){const el=document.getElementById('twep-'+a.id);if(el)el.textContent='第'+ep+'集';}
  });
}

async function loadSchedule(){
  const wrap=document.getElementById('scheduleWrap');
  wrap.innerHTML='<div class="message"><div class="loading-dots"><span></span><span></span><span></span></div></div>';
  try{
    const cal=await fetchCalendar();
    lastCalendar=cal;
    renderTodayWatching(cal);
    const today=new Date().getDay()||7;
    const sorted=[...cal].sort((a,b)=>{
      if(a.weekday.id===today)return -1;
      if(b.weekday.id===today)return 1;
      return 0;
    });
    wrap.innerHTML=sorted.map(day=>{
      const isToday=day.weekday.id===today;
      const items=day.items||[];
      const itemsHtml=items.length?items.map(a=>cardHtml(a)).join(''):'<div class="message" style="padding:1rem 0;grid-column:1/-1">今天没有新番更新</div>';
      return`<div class="day-group${isToday?' today-group':''}">
        <div class="day-header">
          <span class="day-num">${day.weekday.cn||day.weekday.en}</span>
          <span class="day-name${isToday?' today':''}">${isToday?'🔥 今日更新 · ':''}${day.weekday.cn||day.weekday.ja}</span>
          <span class="day-count">${items.length} 部</span>
        </div>
        <div class="grid">${itemsHtml}</div>
      </div>`;
    }).join('');
    sorted.forEach((day,di)=>{
      const groups=wrap.querySelectorAll('.day-group');
      const grid=groups[di]?.querySelector('.grid');
      if(grid&&day.items)bindCards(grid,day.items);
    });
  }catch(e){
    wrap.innerHTML='<div class="message">新番日历加载失败</div>';
  }
}

// ===== 我的番单 =====
function renderMyPage(){
  const tracker=getTracker();
  const all=Object.values(tracker);
  const watching=all.filter(e=>e.status==='watching').length;
  const watched=all.filter(e=>e.status==='watched').length;
  const wish=all.filter(e=>e.status==='wish').length;
  document.getElementById('myStats').innerHTML=`
    <div class="stat-item"><div class="stat-num">${all.length}</div><div class="stat-label">追番总数</div></div>
    <div class="stat-item"><div class="stat-num c-green">${watching}</div><div class="stat-label">在看</div></div>
    <div class="stat-item"><div class="stat-num c-blue">${watched}</div><div class="stat-label">看完</div></div>
    <div class="stat-item"><div class="stat-num c-amber">${wish}</div><div class="stat-label">想看</div></div>
  `;
  const filtered=myTab==='all'?all:all.filter(e=>e.status===myTab);
  const tabNames={all:'全部番单',watching:'在看',wish:'想看',watched:'看完',hold:'搁置',dropped:'放弃'};
  document.getElementById('myListTitle').textContent=tabNames[myTab]||'全部番单';
  document.getElementById('myCount').textContent=`${filtered.length} 部`;
  renderRecs(false);
  const g=document.getElementById('myGrid');
  if(!filtered.length){
    const em={
      all:'还没有追番记录～<br/>点卡片右上角 ♡ 开始追番！',
      watching:'当前没有在看的番(´・ω・`)<br/>在详情里标记「在看」吧',
      wish:'想看列表空空的…<br/>发现好番就点 ♡ 收起来！',
      watched:'还没有看完过番？<br/>刷完第一部来这里打卡！',
      hold:'没有搁置的番，真棒！(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
      dropped:'已放弃的番…<br/>也许有缘会再相遇吧',
    }[myTab]||'暂无内容';
    g.innerHTML=mascotEmpty(em);
    return;
  }
  const sorted=[...filtered].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  g.innerHTML=sorted.map(e=>cardHtml(e.anime,{timeAgo:e.completedAt?timeAgo(e.completedAt):'',userRating:e.rating||0})).join('');
  bindCards(g,sorted.map(e=>e.anime));
}

// ===== 抽屉 =====
function buildTrackSection(anime){
  const entry=getEntry(anime.id);
  const btns=['wish','watching','watched','hold','dropped'].map(s=>`
    <button class="track-btn${entry?.status===s?' tb-active':''}" data-s="${s}">${STATUS_ICONS[s]} ${STATUS_LABELS[s]}</button>
  `).join('');
  const showEps=entry?.status==='watching';
  const prog=entry?.progress||0;
  const showRating=entry?.status==='watched'||entry?.status==='watching';
  const userRating=entry?.rating||0;
  return`<div class="track-section" id="trackSection">
    <div class="section-label">追番状态</div>
    <div class="track-btns" id="trackBtns">${btns}</div>
    <div class="eps-row" id="epsRow" style="${showEps?'':'display:none'}">
      <span>进度</span>
      <button class="eps-adj" id="epsMinus">−</button>
      <span class="eps-num" id="epsNum">${prog}</span>
      <button class="eps-adj" id="epsPlus">+</button>
      <span>/ ${anime.eps||'?'} 集</span>
    </div>
    <div class="rating-row" id="ratingRow" style="${showRating?'':'display:none'}">
      <span>我的评分</span>
      <div class="stars" id="starPicker">${[1,2,3,4,5,6,7,8,9,10].map(i=>`<span class="star${i<=userRating?' active':''}" data-r="${i}">${i<=userRating?'★':'☆'}</span>`).join('')}</div>
    </div>
  </div>`;
}

function wireTrackListeners(anime){
  document.querySelectorAll('#trackBtns .track-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const s=btn.dataset.s;
      const current=getEntry(anime.id);
      if(current?.status===s){
        setStatus(anime,null);
        shionReact('remove');
      }else{
        setStatus(anime,s,current?.progress||0);
        shionReact(s);
      }
      if(navigator.vibrate)navigator.vibrate(10);
      refreshTrackUI(anime);
      updateMyBadge();
      updateAllCardBtns(anime.id);
      updateDrawerQuickBtn(anime.id);
      if(currentView==='my')renderMyPage();
    });
  });
  document.getElementById('epsMinus')?.addEventListener('click',()=>{
    const e=getEntry(anime.id);
    if(!e)return;
    const p=Math.max(0,(e.progress||0)-1);
    setStatus(anime,e.status,p);
    document.getElementById('epsNum').textContent=p;
  });
  document.getElementById('epsPlus')?.addEventListener('click',()=>{
    const e=getEntry(anime.id);
    if(!e)return;
    const p=(e.progress||0)+1;
    setStatus(anime,e.status,p);
    document.getElementById('epsNum').textContent=p;
  });
  document.querySelectorAll('#starPicker .star').forEach(s=>{
    s.addEventListener('click',()=>{
      const r=parseInt(s.dataset.r);
      const e=getEntry(anime.id);
      if(!e)return;
      setStatus(anime,e.status,e.progress,r);
      document.querySelectorAll('#starPicker .star').forEach((st,i)=>{
        st.textContent=i<r?'★':'☆';
        st.classList.toggle('active',i<r);
      });
      shionReact(rateReactKey(r));
    });
  });
}

function refreshTrackUI(anime){
  const entry=getEntry(anime.id);
  document.querySelectorAll('#trackBtns .track-btn').forEach(btn=>{
    btn.classList.toggle('tb-active',entry?.status===btn.dataset.s);
  });
  const epsRow=document.getElementById('epsRow');
  if(epsRow){
    epsRow.style.display=entry?.status==='watching'?'flex':'none';
    document.getElementById('epsNum').textContent=entry?.progress||0;
  }
  const ratingRow=document.getElementById('ratingRow');
  if(ratingRow){
    ratingRow.style.display=(entry?.status==='watched'||entry?.status==='watching')?'flex':'none';
  }
}

function updateDrawerQuickBtn(id){
  const btn=document.getElementById('drawerTrackQuick');
  if(!btn)return;
  const entry=getEntry(id);
  btn.classList.toggle('status-active',!!entry);
  btn.innerHTML=entry?(STATUS_ICONS[entry.status]||'♥'):'♡';
}

// ===== 决策卡：聚合数据 3 秒判断「追不追」 =====
function dcScoreTier(s){
  if(!s)return null;
  if(s>=8.5)return{cls:'tier-god',label:'神作级'};
  if(s>=7.5)return{cls:'tier-good',label:'良作'};
  if(s>=6)return{cls:'tier-mid',label:'中规中矩'};
  return{cls:'tier-bad',label:'谨慎入坑'};
}
function dcEpsLabel(eps){
  if(!eps)return null;
  if(eps<=13)return`${eps}集 · 一季补完`;
  if(eps<=26)return`${eps}集 · 两季承诺`;
  if(eps<40)return`${eps}集 · 中长篇`;
  return`${eps}集 · 长篇大坑`;
}
function dcDistributionRead(count){
  if(!count)return null;
  let total=0,low=0,high=0;
  for(let i=1;i<=10;i++){const v=count[i]||0;total+=v;if(i<=4)low+=v;if(i>=8)high+=v;}
  if(total<30)return null; // 样本太少不下结论，避免误导
  const lowR=low/total,highR=high/total;
  if(highR>=0.15&&lowR>=0.15)return'评分两极，要么封神要么劝退，自己掂量。';
  if(highR>=0.6)return'好评一边倒，闭眼追问题不大。';
  if(lowR>=0.4)return'差评扎堆，下坑前先做好心理准备。';
  return null;
}
function buildDecisionCard(d){
  const score=(d.rating&&d.rating.score)||d.score||0;
  const tier=dcScoreTier(score);
  const eps=d.eps||d.total_episodes||0;
  const epsL=dcEpsLabel(eps);
  const chips=[];
  chips.push(tier?`<span class="dc-chip ${tier.cls}">⭐ ${score.toFixed(1)} ${tier.label}</span>`:`<span class="dc-chip tier-mid">⭐ 暂无评分</span>`);
  if(epsL)chips.push(`<span class="dc-chip">📺 ${epsL}</span>`);
  chips.push(`<span class="dc-chip">${d.is_airing?'🟢 连载中':'✅ 已完结'}</span>`);
  const read=dcDistributionRead(d.rating&&d.rating.count);
  const review=(d.shion_review||'').trim();
  let html=`<div class="decision-card"><div class="dc-chips">${chips.join('')}</div>`;
  if(read)html+=`<div class="dc-read">📊 <span>${read}</span></div>`;
  if(review)html+=`<div class="dc-shion"><span class="dc-shion-av">🔮</span><span class="dc-shion-txt"><span class="dc-shion-label">紫音锐评</span>${esc(review)}</span></div>`;
  html+=`</div>`;
  return html;
}

function cardOrigin(cardEl){
  const im=cardEl&&cardEl.querySelector('img');
  if(!im)return null;
  const r=im.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  return{rect:{left:r.left,top:r.top,width:r.width,height:r.height},src:im.currentSrc||im.src||''};
}
function runContainerTransform(origin,coverEl){
  return new Promise(resolve=>{
    if(!origin||!origin.rect||!coverEl){resolve();return;}
    requestAnimationFrame(()=>{
      const dest=coverEl.getBoundingClientRect();
      const o=origin.rect;
      if(!dest.width||!o.width){resolve();return;}
      const endR=getComputedStyle(coverEl).borderTopLeftRadius||'16px';
      const clone=document.createElement('div');
      clone.className='ct-clone';
      const im=document.createElement('img');
      im.src=String(origin.src);
      clone.appendChild(im);
      // 起点 = 卡片图 rect；内置 object-fit:cover 图，随容器 bounds 变化逐帧重裁，全程零变形
      clone.style.left=o.left+'px';
      clone.style.top=o.top+'px';
      clone.style.width=o.width+'px';
      clone.style.height=o.height+'px';
      clone.style.borderRadius='14px';
      document.body.appendChild(clone);
      void clone.offsetWidth; // 强制 reflow 锁定起点
      const E='cubic-bezier(0.16,1,0.3,1)';
      requestAnimationFrame(()=>{
        clone.style.transition='left .42s '+E+',top .42s '+E+',width .42s '+E+',height .42s '+E+',border-radius .42s ease';
        clone.style.left=dest.left+'px';
        clone.style.top=dest.top+'px';
        clone.style.width=dest.width+'px';
        clone.style.height=dest.height+'px';
        clone.style.borderRadius=endR;
      });
      let done=false;
      const fin=()=>{if(done)return;done=true;clone.remove();resolve();};
      clone.addEventListener('transitionend',e=>{if(e.propertyName==='width'||e.propertyName==='height')fin();});
      setTimeout(fin,600);
    });
  });
}
async function openDrawer(a,origin){
  currentDetailAnime=a;
  const bg=document.getElementById('drawerBg');
  const body=document.getElementById('drawerBody');
  document.getElementById('drawerHeadTitle').textContent=a.name_cn||a.name;
  updateDrawerQuickBtn(a.id);
  const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  const haveImg=!!(a.images&&(a.images.common||a.images.medium||a.images.grid));
  const useCT=!!(origin&&origin.rect&&origin.src&&haveImg&&!reduce&&window.innerWidth<768);
  if(haveImg){
    const cov=imgSrc(a.images.common||a.images.medium||a.images.grid);
    body.innerHTML=`<img class="drawer-cover img-fade" id="drawerCover" src="${cov}" alt="" onload="imgLoaded(this)"/><div class="drawer-title">${a.name_cn||a.name}</div><div class="message" style="padding:24px 0"><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  }else{
    body.innerHTML='<div class="message"><div class="loading-dots"><span></span><span></span><span></span></div></div>';
  }
  bg.classList.toggle('ct',useCT);
  bg.classList.add('open');
  document.body.style.overflow='hidden';
  let morphDone=Promise.resolve();
  if(useCT)morphDone=runContainerTransform(origin,document.getElementById('drawerCover'));
  try{
    const [d]=await Promise.all([fetchDetail(a.id),morphDone]);
    currentDetailAnime=d;
    const img=imgSrc(d.images?.common||d.images?.large||'');
    const title=d.name_cn||d.name;
    const sub=[d.name,d.date?d.date.slice(0,4)+'年':'',d.eps?`共${d.eps}集`:''].filter(Boolean).join(' · ');
    const tags=(d.tags||[]).slice(0,8).map(t=>`<span class="drawer-tag">${t.name}</span>`).join('');
    const desc=d.summary?d.summary.trim():'暂无简介';
    const longDesc=desc.length>120;
    let ratingHtml='';
    const r=d.rating;
    if(r&&r.score){
      const stars=Array.from({length:5},(_,i)=>`<span class="star${i<Math.round(r.score/2)?'':' empty'}">★</span>`).join('');
      const entries=r.count?Object.entries(r.count).sort((a,b)=>b[0]-a[0]):[];
      const max=entries.length?Math.max(...entries.map(e=>e[1])):1;
      const bars=entries.map(([k,v])=>`<div class="bar-row"><span class="bar-label">${k}</span><div class="bar-track"><div class="bar-fill" style="width:${max?Math.round(v/max*100):0}%"></div></div><span class="bar-count">${v}</span></div>`).join('');
      ratingHtml=`<div class="rating-section"><div class="rating-top"><div class="rating-num">${r.score.toFixed(1)}</div><div><div class="rating-stars">${stars}</div><div class="rating-info">${(r.total||0).toLocaleString()} 人评分${r.rank?` · 排名 #${r.rank}`:''}</div></div></div><div>${bars}</div></div>`;
    }else{
      ratingHtml=`<div class="rating-section" style="padding:12px;color:var(--text3);font-size:13px;text-align:center">暂无评分数据</div>`;
    }
    const encTitle=encodeURIComponent(title);
    body.innerHTML=`
      <img class="drawer-cover img-fade" src="${img}" alt="" onload="imgLoaded(this)"/>
      <div class="drawer-title">${title}</div>
      <div class="drawer-subtitle">${sub}</div>
      <div class="drawer-tags">${tags}</div>
      ${buildDecisionCard(d)}
      <div class="review-section" id="reviewSection"></div>
      ${buildTrackSection(d)}
      ${ratingHtml}
      <div class="char-section" id="charSection" style="display:none"></div>
      <button class="share-card-btn" id="shareCardBtn">📤 生成分享卡片</button>
      <div class="desc-section">
        <div class="section-label">简介</div>
        <div class="desc-text${longDesc?' collapsed':''}" id="descText">${desc}</div>
        ${longDesc?'<button class="expand-btn" id="expandBtn">展开全部 ↓</button>':''}
      </div>
      <div class="watch-section">
        <button class="watch-btn primary" onclick="openWatchUrl('https://bgm.tv/subject/${d.id}')">📖 在 Bangumi 查看更多</button>
        <button class="watch-btn" onclick="openWatchUrl('https://search.bilibili.com/all?keyword=${encTitle}')">🎬 B站</button>
        <button class="watch-btn" onclick="openWatchUrl('https://www.iqiyi.com/search?key=${encTitle}')">📺 爱奇艺</button>
        <button class="watch-btn" onclick="openWatchUrl('https://www.youku.com/search_video/q_${encTitle}')">📺 优酷</button>
        <button class="watch-btn" onclick="openWatchUrl('https://v.qq.com/search.html#stag=0&searchValue=${encTitle}')">📺 腾讯</button>
      </div>`;
    wireTrackListeners(d);
    updateDrawerQuickBtn(d.id);
    loadCharacters(d.id);
    document.getElementById('shareCardBtn')?.addEventListener('click',()=>openShareCard(d));
    document.getElementById('expandBtn')?.addEventListener('click',()=>{
      document.getElementById('descText').classList.remove('collapsed');
      document.getElementById('expandBtn').style.display='none';
    });
    // 加载社区评价
    if(window.fanji&&window.fanji.loadReviewSection){
      window.fanji.loadReviewSection(d.id,document.getElementById('reviewSection'));
    }
  }catch(e){
    body.innerHTML='<div class="message" style="padding:2rem">加载失败</div>';
  }
}

// 抽屉快捷按钮（想看 toggle）
document.getElementById('drawerTrackQuick').addEventListener('click',()=>{
  if(!currentDetailAnime)return;
  const id=currentDetailAnime.id;
  const entry=getEntry(id);
  if(!entry){
    setStatus(currentDetailAnime,'wish');
    shionReact('wish');
  }else if(entry.status==='wish'){
    setStatus(currentDetailAnime,null);
    shionReact('remove');
  }else{
    showToast(`当前状态「${STATUS_LABELS[entry.status]}」`);
    return;
  }
  if(navigator.vibrate)navigator.vibrate(10);
  updateDrawerQuickBtn(id);
  updateAllCardBtns(id);
  updateMyBadge();
  if(currentView==='my')renderMyPage();
  // 如果抽屉内 track section 存在，刷新它
  if(document.getElementById('trackSection'))refreshTrackUI(currentDetailAnime);
});

document.getElementById('drawerClose').addEventListener('click',closeDrawer);
document.getElementById('drawerBg').addEventListener('click',e=>{if(e.target===document.getElementById('drawerBg'))closeDrawer();});
function closeDrawer(){document.getElementById('drawerBg').classList.remove('open');document.body.style.overflow='';currentDetailAnime=null;}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.getElementById('personBg').classList.contains('open')){closePerson();return;}closeShareCard();closeDrawer();}});

// ===== 角色 & 声优 =====
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function loadCharacters(id){
  const sec=document.getElementById('charSection');
  if(!sec)return;
  let list=[];
  try{list=await fetchCharacters(id);}catch(e){list=[];}
  // 抽屉可能已被关闭或切换到别的番
  const cur=document.getElementById('charSection');
  if(!cur||cur!==sec)return;
  if(!list||!list.length){sec.style.display='none';return;}
  const cards=list.slice(0,30).map(c=>{
    const va=c.actors&&c.actors[0];
    const isMain=c.relation==='主角';
    return `<div class="char-card">
      <div class="char-thumb">
        ${c.image?`<img src="${esc(imgSrc(c.image))}" alt="" loading="lazy" class="img-fade" onload="imgLoaded(this)" onerror="this.style.visibility='hidden'"/>`:''}
        ${c.relation?`<span class="char-relation${isMain?' main':''}">${esc(c.relation)}</span>`:''}
      </div>
      <div class="char-name">${esc(c.name)}</div>
      ${va?`<div class="char-va" data-person="${esc(va.id)}">${va.image?`<img src="${esc(imgSrc(va.image))}" alt="" class="img-fade" onload="imgLoaded(this)" onerror="this.style.display='none'"/>`:''}<span>${esc(va.name)}</span></div>`:''}
    </div>`;
  }).join('');
  sec.innerHTML=`<div class="section-label">角色 &amp; 声优</div><div class="char-scroll">${cards}</div>`;
  sec.style.display='block';
  sec.querySelectorAll('.char-va').forEach(el=>el.addEventListener('click',()=>openPerson(el.dataset.person)));
}

async function openPerson(personId){
  if(!personId)return;
  const bg=document.getElementById('personBg');
  const body=document.getElementById('personBody');
  document.getElementById('personHeadTitle').textContent='声优';
  body.innerHTML='<div class="message"><div class="loading-dots"><span></span><span></span><span></span></div></div>';
  bg.classList.add('open');
  document.body.style.overflow='hidden';
  if(navigator.vibrate)navigator.vibrate(8);
  const p=await fetchPerson(personId);
  if(!bg.classList.contains('open'))return;
  if(!p){body.innerHTML='<div class="message" style="padding:2rem">声优信息加载失败</div>';return;}
  document.getElementById('personHeadTitle').textContent=p.name||'声优';
  const works=p.works||[];
  const inApp=works.filter(w=>w.app_id).length;
  const grid=works.map(w=>{
    const title=w.name_cn||w.name||'';
    const locked=!w.app_id;
    return `<div class="work-card${locked?' locked':''}" data-app="${w.app_id||''}" data-bgm="${esc(w.bangumi_id)}" data-title="${esc(title)}">
      <div class="work-cover">
        ${w.image?`<img src="${esc(imgSrc(w.image))}" alt="" loading="lazy" class="img-fade" onload="imgLoaded(this)" onerror="this.style.visibility='hidden'"/>`:''}
        ${locked?'<span class="work-lock">站外</span>':''}
        ${w.relation?`<span class="work-staff">${esc(w.relation)}</span>`:''}
      </div>
      <div class="work-title">${esc(title)}</div>
      ${w.char_name?`<div class="work-char">饰 ${esc(w.char_name)}</div>`:''}
    </div>`;
  }).join('');
  body.innerHTML=`
    <div class="person-hero">
      <img class="person-avatar img-fade" src="${esc(imgSrc(p.image||''))}" alt="" onload="imgLoaded(this)" onerror="this.style.visibility='hidden'"/>
      <div>
        <div class="person-name">${esc(p.name||'')}</div>
        ${p.career?`<div class="person-meta">${esc(p.career)}</div>`:''}
        <div class="person-count">${works.length} 部作品${inApp?` · ${inApp} 部可在站内查看`:''}</div>
      </div>
    </div>
    ${grid?`<div class="works-grid">${grid}</div>`:'<div class="char-empty">暂无作品数据</div>'}`;
  body.querySelectorAll('.work-card').forEach(el=>el.addEventListener('click',()=>{
    const appId=el.dataset.app;
    if(appId){closePerson();openDrawer({id:Number(appId),name_cn:el.dataset.title,name:el.dataset.title});}
    else{openWatchUrl('https://bgm.tv/subject/'+el.dataset.bgm);}
  }));
}
function closePerson(){document.getElementById('personBg').classList.remove('open');}
document.getElementById('personClose').addEventListener('click',closePerson);
document.getElementById('personBg').addEventListener('click',e=>{if(e.target===document.getElementById('personBg'))closePerson();});

// 分享卡片浮层事件
function closeShareCard(){document.getElementById('shareBg').classList.remove('open');}
document.getElementById('shareClose').addEventListener('click',closeShareCard);
document.getElementById('shareBg').addEventListener('click',e=>{if(e.target===document.getElementById('shareBg'))closeShareCard();});
document.getElementById('shareSaveBtn').addEventListener('click',()=>{
  if(!_shareBlob)return;
  const url=URL.createObjectURL(_shareBlob);
  const a=document.createElement('a');a.href=url;a.download=_shareName;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  showToast('已保存卡片图片');
});
document.getElementById('shareSendBtn').addEventListener('click',async()=>{
  if(!_shareBlob)return;
  const file=new File([_shareBlob],_shareName,{type:'image/png'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file],text:_shareText});}
    catch(e){if(e.name!=='AbortError')showToast('分享已取消');}
  }else{
    showToast('当前环境不支持直接分享，已为你保存图片');
    document.getElementById('shareSaveBtn').click();
  }
});

// ===== 导航 =====
const NAV_ORDER=[...document.querySelectorAll('.bn-item')].map(b=>b.dataset.view);
function switchView(view){
  const prev=currentView;
  currentView=view;
  const from=NAV_ORDER.indexOf(prev), to=NAV_ORDER.indexOf(view);
  const dir=(from>=0&&to>=0&&to<from)?-1:1;
  // 社区 tab — 先重置标志再切视图，确保 Observer 能检测到需要加载
  if(view==='community'){
    const commView=document.getElementById('view-community');
    if(commView){commView.dataset.loaded='';commView.setAttribute('data-loaded','');}
    // 直接触发 feed 刷新，不依赖 Observer 时序
    if(window.fanji&&window.fanji.refreshFeed)window.fanji.refreshFeed();
  }
  const target=document.getElementById('view-'+view);
  target.style.setProperty('--vx',dir<0?'-28px':'28px');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.bn-item').forEach(t=>t.classList.toggle('active',t.dataset.view===view));
  window.scrollTo({top:0,behavior:'smooth'});
  if(view==='discover'){resetDiscover();loadDiscover();}
  if(view==='hot'&&!document.getElementById('hotGrid').querySelector('.card'))loadHot();
  if(view==='ranking'&&!document.getElementById('rankGrid').querySelector('.card'))loadRanking();
  if(view==='schedule'&&!document.getElementById('scheduleWrap').querySelector('.day-group'))loadSchedule();
  else if(view==='schedule'&&lastCalendar)renderTodayWatching(lastCalendar);
  if(view==='my')renderMyPage();
  history.replaceState(null,'','#'+view);
}
document.querySelectorAll('.bn-item').forEach(t=>t.addEventListener('click',()=>{haptic(8);switchView(t.dataset.view);}));
document.getElementById('logoHome').addEventListener('click',()=>switchView('hot'));

// 滚动增强：navbar elevation + hero 大标题收缩（iOS 质感，rAF 节流）
(function initScrollFx(){
  const navbar=document.querySelector('.navbar');
  const heroCopy=document.querySelector('#view-hot .hero-shion-copy');
  const reduceMo=matchMedia('(prefers-reduced-motion:reduce)');
  let scrolled=false,ticking=false;
  function apply(){
    ticking=false;
    const y=window.scrollY||document.documentElement.scrollTop||0;
    const s=y>6;
    if(s!==scrolled){scrolled=s;navbar.classList.toggle('scrolled',s);}
    if(heroCopy){
      const p=(currentView==='hot'&&!reduceMo.matches)?Math.min(y/200,1):0;
      heroCopy.style.setProperty('--hero-collapse',p.toFixed(3));
    }
  }
  window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(apply);}},{passive:true});
  apply();
})();

// 标签筛选
document.getElementById('tagFilters').querySelectorAll('.filter-tag').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('#tagFilters .filter-tag').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    hotState.tag=t.dataset.val;
    hotState.search='';
    hotState.page=1;
    document.getElementById('searchInput').value='';
    loadHot();
  });
});

// 年份筛选
(function initYearFilters(){
  const now=new Date().getFullYear();
  const hotSelect=document.getElementById('hotYearSelect');
  const rankSelect=document.getElementById('rankYearSelect');
  const options='<option value="">📅 全部年份</option>'+Array.from({length:now-1999},(_,i)=>now-i).map(y=>`<option value="${y}">📅 ${y}年</option>`).join('');
  hotSelect.innerHTML=options;
  rankSelect.innerHTML=options;
  function bindYearFilter(select,airingBtn,state,loadFn){
    select.addEventListener('change',()=>{
      state.year=select.value;
      state.page=1;
      state.airing=false;
      airingBtn.classList.remove('active');
      loadFn();
    });
    airingBtn.addEventListener('click',()=>{
      const active=airingBtn.classList.toggle('active');
      state.airing=active;
      state.year='';
      state.page=1;
      select.value='';
      loadFn();
    });
  }
  bindYearFilter(hotSelect,document.getElementById('hotAiringBtn'),hotState,loadHot);
  bindYearFilter(rankSelect,document.getElementById('rankAiringBtn'),rankState,loadRanking);
})();

// 搜索
const doSearch=()=>{
  const q=document.getElementById('searchInput').value.trim();
  if(!q)return;
  hotState.search=q;
  hotState.tag='';
  hotState.page=1;
  document.querySelectorAll('#tagFilters .filter-tag').forEach(x=>x.classList.remove('active'));
  if(currentView!=='hot')showToast(`正在搜索「${q}」…`);
  switchView('hot');
  loadHot();
};
document.getElementById('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.target.blur();doSearch();}});

// ===== "我的"页 tabs =====
document.getElementById('statusTabs').querySelectorAll('.status-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('#statusTabs .status-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    myTab=t.dataset.tab;
    renderMyPage();
  });
});

// ===== 导出 / 导入 =====
function exportData(){
  const tracker=getTracker();
  const vals=Object.values(tracker);
  const data={
    app:'FanJi',version:'2.0',
    exportedAt:new Date().toISOString(),
    tracker,
    meta:{total:vals.length,watching:vals.filter(e=>e.status==='watching').length,watched:vals.filter(e=>e.status==='watched').length}
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`fanji-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('已导出番单备份 📤');
}

document.getElementById('statsCardBtn').addEventListener('click',openStatsCard);
document.getElementById('exportBtn').addEventListener('click',exportData);
document.getElementById('importBtn').addEventListener('click',()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change',e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(!data.tracker||typeof data.tracker!=='object')throw new Error();
      const current=getTracker();
      saveTracker({...current,...data.tracker});
      updateMyBadge();
      if(currentView==='my')renderMyPage();
      showToast(`导入成功，共 ${Object.keys(data.tracker).length} 部 📥`);
    }catch(err){
      showToast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value='';
});

// ===== Toast =====
let toastTimer;
function showToast(msg,onUndo){
  const t=document.getElementById('toast');
  if(onUndo){
    t.innerHTML=`${msg} <button class="toast-undo">撤销</button>`;
    t.querySelector('.toast-undo').addEventListener('click',()=>{
      onUndo();
      t.classList.remove('show');
    });
  }else{
    t.textContent=msg;
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),onUndo?4000:2000);
}

// ===== 紫音即时反应：对评分/弃番/追番动作弹人格气泡（复用状态栏情绪谱😏😒😠💢，纯文字、零运行时AI）=====
// ===== 紫音立绘表情（随状态切换；无对应图则保持默认立绘，零回归，出图后自动点亮）=====
const SHION_FACES_READY=true; // 出好表情图(见 shion-redesign/face-prompts.md)后改 true 即点亮；false 时零请求零开销
const SHION_FACE_DEFAULT='shion-hero.png';
const SHION_FACE_FILES={smug:'shion-face-smug.png',pout:'shion-face-pout.png',angry:'shion-face-angry.png',happy:'shion-face-happy.png',rage:'shion-face-rage.png'};
const EMOJI_FACE={'😏':'smug','😒':'pout','😠':'angry','✨':'happy','💢':'rage'};
const _faceReady={};
if(SHION_FACES_READY)Object.entries(SHION_FACE_FILES).forEach(([k,f])=>{const im=new Image();im.onload=()=>{_faceReady[k]=f;};im.src=f;});
let _faceTimer=null;
function setShionFace(key,holdMs){
  if(!SHION_FACES_READY)return;
  const el=document.getElementById('shionHeroArt');
  const f=_faceReady[key];
  if(!el||!f)return; // 该表情还没出图 → 保持默认立绘
  el.src=f;
  if(_faceTimer)clearTimeout(_faceTimer);
  if(holdMs)_faceTimer=setTimeout(()=>{el.src=SHION_FACE_DEFAULT;_faceTimer=null;},holdMs);
}
const SHION_REACT={
  rate_god :{e:'😏',lines:['哟，眼光不错嘛，这分我承认。','9分起步？算你识货。','高分伺候，这才像看番的样子。']},
  rate_good:{e:'😏',lines:['良作没跑，这分给得挺中肯。','嗯，不亏，这分实诚。']},
  rate_mid :{e:'😒',lines:['中规中矩，你也挺纠结的吧。','不上不下，懂，我也这感觉。']},
  rate_bad :{e:'😠',lines:['这么低？看来是真踩雷了，辛苦你。','打这么狠，是被伤到了哈。','我就说吧，这番不太行。']},
  wish     :{e:'😏',lines:['先码着，别又躺收藏夹吃灰。','想看就想看，记得是真去看啊。']},
  watching :{e:'😏',lines:['开追了？那就别半途而废。','在看了，进度自己标，别问我看到哪。']},
  watched  :{e:'✨',lines:['看完啦，给你鼓个掌——记得打分。','通关！这一部没白看吧？']},
  hold     :{e:'😒',lines:['搁置了？这坑你迟早得回来填。','先放放也行，别忘了就成。']},
  dropped  :{e:'😏',lines:['弃了？我早提醒过你的。','果断弃，省下的时间是赚的。','弃番不丢人，硬撑才丢人。']},
  remove   :{e:'😒',lines:['不追了？随你。','移了就移了，别回头后悔。']}
};
let srTimer;
function shionReact(key){
  const r=SHION_REACT[key];
  if(!r)return;
  const line=r.lines[Math.floor(Math.random()*r.lines.length)];
  const box=document.getElementById('shionReact');
  box.innerHTML=`<span class="sr-face">${r.e}</span><span class="sr-text"><span class="sr-name">紫音</span>${esc(line)}</span>`;
  box.classList.add('show');
  setShionFace(EMOJI_FACE[r.e],2800); // 立绘同步换表情（有图才生效）
  clearTimeout(srTimer);
  srTimer=setTimeout(()=>box.classList.remove('show'),2800);
}
function rateReactKey(r){return r>=9?'rate_god':r>=7?'rate_good':r>=5?'rate_mid':'rate_bad';}

// ===== 紫音开屏欢迎弹窗 =====
const SHION_SPLASH_LINES=[
  '今天想看点什么？紫音替你挑，别自己瞎逛。',
  '又来了？来都来了，让我帮你找部值得的。',
  '别让番在收藏夹里养灰，挑一部<b>现在</b>就看的。',
  '心情都写脸上了。要燃的、要哭的、还是要下饭的？',
  '挑番交给有品味的我，你负责看就行。',
  '哼，眼光这东西，跟着紫音学就对了。'
];
function showShionSplash(){
  try{if(sessionStorage.getItem('shionSplashShown'))return;}catch(e){}
  const el=document.getElementById('shionSplash');
  if(!el)return;
  const b=document.getElementById('spBubble');
  if(b)b.innerHTML=SHION_SPLASH_LINES[Math.floor(Math.random()*SHION_SPLASH_LINES.length)];
  el.hidden=false;
  requestAnimationFrame(()=>el.classList.add('show'));
  let closed=false;
  const close=()=>{if(closed)return;closed=true;el.classList.remove('show');setTimeout(()=>{el.hidden=true;},450);try{sessionStorage.setItem('shionSplashShown','1');}catch(e){}};
  document.getElementById('spEnter')?.addEventListener('click',close);
  document.getElementById('spSkip')?.addEventListener('click',close);
  el.addEventListener('click',e=>{if(e.target===el)close();});
  setTimeout(close,5000);
}

// ===== 推荐系统 =====
const REC_MIN_FAVS=3;
const COMMON_TAGS=new Set(['动画','TV','日本','日本动画','OVA','剧场版','漫画改','小说改','WEB','原创','短片','美国','美国动画','中国','中国动画']);
let recPool=null;
let recFavSnapshot='';

function getFavsForRec(){
  return Object.values(getTracker()).filter(e=>e.status!=='dropped').map(e=>e.anime).filter(Boolean);
}

function buildProfile(){
  const favs=getFavsForRec();
  if(favs.length<REC_MIN_FAVS)return null;
  const tagCount={};
  favs.forEach(f=>(f.tags||[]).forEach(t=>{const n=typeof t==='string'?t:t.name;tagCount[n]=(tagCount[n]||0)+1;}));
  const tagWeights={};
  Object.entries(tagCount).forEach(([tag,count])=>{
    let w=count/favs.length;
    if(COMMON_TAGS.has(tag))w*=0.15;
    tagWeights[tag]=w;
  });
  const scores=favs.map(f=>f.rating?.score||f.score).filter(Boolean);
  const avgScore=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:7.5;
  const years=favs.map(f=>f.date?parseInt(f.date.slice(0,4)):null).filter(Boolean);
  years.sort((a,b)=>a-b);
  const medianYear=years.length?years[Math.floor(years.length/2)]:2020;
  const trackedIds=new Set(Object.keys(getTracker()).map(Number));
  return{tagWeights,avgScore,medianYear,favoriteIds:trackedIds,favorites:favs,
    topTags:Object.entries(tagWeights).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0])};
}

async function gatherCandidates(profile){
  const seen=new Set();
  const candidates=[];
  for(const tag of profile.topTags){
    try{
      const data=await fetchTagSubjects(tag);
      (data.data||[]).forEach(item=>{
        if(!seen.has(item.id)&&!profile.favoriteIds.has(item.id)){
          seen.add(item.id);item._sourceTag=tag;candidates.push(item);
        }
      });
    }catch(e){}
  }
  const topFavs=[...profile.favorites].filter(f=>f.rating?.score||f.score).sort((a,b)=>(b.rating?.score||b.score)-(a.rating?.score||a.score)).slice(0,2);
  for(const fav of topFavs){
    try{
      const rels=await fetchRelated(fav.id);
      (rels||[]).forEach(rel=>{
        if(rel.type===2&&!seen.has(rel.id)&&!profile.favoriteIds.has(rel.id)){
          seen.add(rel.id);
          candidates.push({id:rel.id,name:rel.name,name_cn:rel.name_cn,images:rel.images,_isRelated:fav.name_cn||fav.name});
        }
      });
    }catch(e){}
  }
  return candidates;
}

function scoreCandidate(c,profile){
  const candTags=(c.tags||[]).map(t=>typeof t==='string'?t:t.name);
  let tagMatch=0,totalWeight=0;
  Object.entries(profile.tagWeights).forEach(([t,w])=>{totalWeight+=w;if(candTags.includes(t))tagMatch+=w;});
  const tagScore=totalWeight?tagMatch/totalWeight:0;
  const cScore=c.rating?.score||c.score;
  let scoreScore=0;
  if(cScore){const diff=Math.abs(cScore-profile.avgScore);scoreScore=Math.max(0,1-diff/3);if(cScore<6)scoreScore*=0.2;}
  else scoreScore=0.3;
  let relScore=c._isRelated?1:Math.min(candTags.filter(t=>profile.tagWeights[t]).length/4,1);
  let eraScore=0.5;
  if(c.date){const y=parseInt(c.date.slice(0,4));eraScore=Math.max(0,1-Math.abs(y-profile.medianYear)/15);}
  const total=tagScore*0.4+scoreScore*0.25+relScore*0.25+eraScore*0.1;
  let reason='';
  if(c._isRelated)reason=`《${c._isRelated}》相关`;
  else if(tagScore>0.5){const matched=profile.topTags.find(t=>candTags.includes(t));reason=matched?`「${matched}」高分作品`:'多标签匹配';}
  else if(relScore>0.5)reason='品味相似度高';
  else if(cScore>=8&&scoreScore>0.6)reason='符合你的高分喜好';
  else reason='综合推荐';
  return{...c,_recScore:total,_reason:reason};
}

async function computeRecs(forceRefresh){
  const profile=buildProfile();
  if(!profile)return null;
  const sig=[...profile.favoriteIds].sort((a,b)=>a-b).join(',');
  if(!forceRefresh&&recPool&&recFavSnapshot===sig){
    const shuffled=[...recPool].sort(()=>Math.random()-0.5);
    return{recs:shuffled.slice(0,12),profile};
  }
  const candidates=await gatherCandidates(profile);
  const scored=candidates.map(c=>scoreCandidate(c,profile)).sort((a,b)=>b._recScore-a._recScore);
  recPool=scored.slice(0,40);
  recFavSnapshot=sig;
  return{recs:recPool.slice(0,12),profile};
}

function cardWithReason(a){
  const img=imgSrc(a.images?.common||a.images?.medium||a.images?.grid||'');
  const s=a.rating?.score||a.score;
  const score=s?`★ ${s.toFixed(1)}`:'暂无';
  const cls=s?'card-score':'card-score none';
  const year=a.date?a.date.slice(0,4):'';
  const tags=(a.tags||[]).slice(0,2).map(t=>`<span class="tag-pill">${typeof t==='string'?t:t.name}</span>`).join('');
  const{icon,cls:statusCls}=getTrackIcon(a.id);
  return`<div class="card" data-id="${a.id}">
    <div class="card-img-wrap">
      <button class="fav-btn ${statusCls}" data-fid="${a.id}">${icon}</button>
      <img src="${img}" alt="" loading="lazy" class="img-fade" onload="imgLoaded(this)"/>
      <div class="rec-reason">${a._reason}</div>
    </div>
    <div class="card-body">
      <div class="card-title">${a.name_cn||a.name}</div>
      <div class="card-meta"><span class="${cls}">${score}</span><span class="card-year">${year}</span></div>
      <div class="card-tags">${tags}</div>
    </div>
  </div>`;
}

async function renderRecs(forceRefresh){
  const section=document.getElementById('recSection');
  const grid=document.getElementById('recGrid');
  const intro=document.getElementById('recIntro');
  const favs=getFavsForRec();
  if(favs.length<REC_MIN_FAVS){section.style.display='none';return;}
  section.style.display='block';
  intro.textContent='';
  grid.innerHTML='<div class="rec-loading"><div class="loading-dots"><span></span><span></span><span></span></div><div style="margin-top:8px">分析你的口味中...</div></div>';
  try{
    const result=await computeRecs(forceRefresh);
    if(!result||!result.recs.length){grid.innerHTML='<div class="rec-empty">暂时找不到合适的推荐，多标记几部不同类型试试</div>';return;}
    const{recs,profile}=result;
    intro.textContent=`基于你的 ${favs.length} 部追番，主要口味：${profile.topTags.slice(0,3).join('、')}`;
    grid.innerHTML=recs.map(cardWithReason).join('');
    bindCards(grid,recs);
  }catch(e){
    grid.innerHTML='<div class="rec-empty">推荐加载失败，请稍后再试</div>';
  }
}

document.getElementById('recRefresh').addEventListener('click',()=>{
  if(navigator.vibrate)navigator.vibrate(10);
  renderRecs(true);
});

// ===== PWA =====
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      if(reg.active||navigator.serviceWorker.controller){
        navigator.serviceWorker.controller?.postMessage('trim-cache');
      }else{
        reg.addEventListener('updatefound',()=>{
          reg.installing.addEventListener('statechange',()=>{
            if(reg.active||navigator.serviceWorker.controller){
              navigator.serviceWorker.controller?.postMessage('trim-cache');
            }
          });
        });
      }
    }).catch(()=>{});
  });
}
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredInstallPrompt=e;
  document.getElementById('installBtn').classList.add('show');
});
document.getElementById('installBtn').addEventListener('click',async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();
  const{outcome}=await deferredInstallPrompt.userChoice;
  if(outcome==='accepted'){showToast('安装成功！🎉');document.getElementById('installBtn').classList.remove('show');}
  deferredInstallPrompt=null;
});
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;}
function isStandalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone;}
if(isIOS()&&!isStandalone()&&!localStorage.getItem(IOS_TIP_KEY)){
  setTimeout(()=>document.getElementById('iosInstallTip').classList.add('show'),3000);
}
document.getElementById('iosTipClose').addEventListener('click',()=>{
  document.getElementById('iosInstallTip').classList.remove('show');
  localStorage.setItem(IOS_TIP_KEY,'1');
});

// ===== 初始化 =====
migrateFromFavorites();
updateMyBadge();
const hash=location.hash.slice(1);
if(['hot','ranking','schedule','my','favorites','discover','community'].includes(hash)){
  switchView(hash==='favorites'?'my':hash);
}else{
  switchView('hot');
}
// ===== 紫音主场 hero 开场白（结合时段 + 今日在追更新；点一下换一句）=====
const HERO_QUOTES=[
  '哼，挑番交给我，你负责看就行。',
  '今天想看点什么？说不出来就听我的。',
  '别在收藏夹里养灰了，挑一部现在就看。',
  '眼光这东西，跟着我学就对了。',
  '来都来了，让我帮你找部值得的。',
  '犹豫就是浪费生命，番我都替你筛好了。',
  '又来了？算你识货，坐下我给你推。'
];
// 返回当前情境下的台词池：优先"今日在追更新"，否则时段问候 + 通用语录
function heroQuoteLines(){
  const upd=(lastCalendar)?getTodayWatching(lastCalendar):[];
  if(upd.length){
    const t=upd[0].name_cn||upd[0].name;
    if(upd.length===1)return[
      `《${t}》今天更新了，还不去看？`,
      `你追的《${t}》出新的了，看完记得回来标进度。`,
      `《${t}》更新日到了，紫音可不提醒第二遍。`
    ];
    return[
      `你追的 ${upd.length} 部今天更新了，《${t}》打头，别拖到忘。`,
      `今天有 ${upd.length} 部在等你，紫音都帮你盯着呢。`,
      `${upd.length} 部更新了哦，挑一部现在就看。`
    ];
  }
  const h=new Date().getHours();
  let tod;
  if(h<5)tod=['都几点了还不睡？看完这集就关灯。','深夜放毒最香，紫音陪你看一部。'];
  else if(h<11)tod=['早。今天想看点什么？说不出来就听我的。','一日之计在于晨，补番也算。'];
  else if(h<18)tod=['下午了，挑一部轻松的配茶？','摸鱼时间到，紫音给你推一部。'];
  else tod=['忙完了吧？犒劳自己，挑一部。','晚上了，正是看番的好时候。'];
  return [...tod,...HERO_QUOTES];
}
function setHeroQuote(){
  const el=document.getElementById('heroQuoteText');
  if(!el)return;
  const lines=heroQuoteLines();
  let q;do{q=lines[Math.floor(Math.random()*lines.length)];}while(q===el.textContent&&lines.length>1);
  el.textContent=q;
}
document.getElementById('heroQuote')?.addEventListener('click',setHeroQuote);
setHeroQuote();
loadHeroFeature();

// ===== 紫音对话（看番搭子）=====
let scHistory=[];
let scBusy=false;
function scAddMsg(who,text){
  const box=document.getElementById('scMsgs');
  const d=document.createElement('div');
  d.className='sc-msg '+(who==='me'?'me':'shion');
  d.textContent=text;
  box.appendChild(d);
  box.scrollTop=box.scrollHeight;
  return d;
}
function createChatCard(anime){
  const el=document.createElement('div');
  el.className='sc-card';
  el.dataset.id=anime.id;
  const coverSrc=imgSrc(anime.cover_url||'');
  el.innerHTML=`<img class="sc-card-img" src="${coverSrc}" alt="" loading="lazy" onerror="this.style.display='none'"/><div class="sc-card-body"><div class="sc-card-title">${esc(anime.title||'')}</div><div class="sc-card-meta"><span class="sc-card-score">★ ${anime.score||'?'}</span></div></div>`;
  el.addEventListener('click',()=>{haptic(8);openDrawer({id:anime.id,name:anime.title,name_cn:anime.title,images:{common:anime.cover_url,medium:anime.cover_url},score:anime.score||0},null);});
  return el;
}
function scOpen(){
  const el=document.getElementById('shionChat');
  if(!el)return;
  el.hidden=false;
  requestAnimationFrame(()=>el.classList.add('show'));
  const fab=document.getElementById('shionFab');if(fab)fab.style.display='none';
  if(!scHistory.length)scAddMsg('shion','哟，来啦。今天想看点什么——说个心情或类型，我替你挑。');
  setTimeout(()=>document.getElementById('scInput')?.focus(),320);
}
function scClose(){
  const el=document.getElementById('shionChat');
  if(!el)return;
  el.classList.remove('show');
  setTimeout(()=>{el.hidden=true;const fab=document.getElementById('shionFab');if(fab)fab.style.display='';},420);
}
async function scSend(text){
  text=(text||'').trim();
  if(scBusy||!text)return;
  scBusy=true;haptic(8);
  const sendBtn=document.getElementById('scSend');if(sendBtn)sendBtn.disabled=true;
  scAddMsg('me',text);
  scHistory.push({role:'user',content:text});
  if(scHistory.length>20)scHistory=scHistory.slice(-20);
  const typing=scAddMsg('shion','紫音正在敲键盘…');typing.classList.add('typing');
  try{
    const d=await apiFetch('/api/shion/chat',{body:{messages:scHistory}});
    typing.remove();
    if(d&&d.ok&&d.reply){
      const bubble=scAddMsg('shion',d.reply);
      scHistory.push({role:'assistant',content:d.reply});
      if(d.cards&&d.cards.length){
        const container=document.createElement('div');
        container.className='sc-cards';
        d.cards.forEach(c=>container.appendChild(createChatCard(c)));
        bubble.after(container);
        document.getElementById('scMsgs').scrollTop=document.getElementById('scMsgs').scrollHeight;
      }
    }
    else scAddMsg('shion',(d&&d.error)||'紫音卡壳了，再说一遍？');
  }catch(e){typing.remove();scAddMsg('shion','网络不给力，紫音没收到…');}
  finally{scBusy=false;if(sendBtn)sendBtn.disabled=false;}
}
document.getElementById('shionFab')?.addEventListener('click',scOpen);
document.getElementById('scClose')?.addEventListener('click',scClose);
document.getElementById('scForm')?.addEventListener('submit',e=>{e.preventDefault();const inp=document.getElementById('scInput');const t=inp.value;inp.value='';scSend(t);});

// ===== 原生手感：触感 + 底部 sheet 拖拽下滑关闭 =====
function haptic(ms=10){try{navigator.vibrate&&navigator.vibrate(ms);}catch(e){}}
function enableSheetDrag(sheet,zones,onClose){
  let startY=0,dy=0,dragging=false;
  const start=e=>{const t=e.touches?e.touches[0]:e;startY=t.clientY;dy=0;dragging=true;sheet.classList.add('sheet-dragging');};
  const move=e=>{if(!dragging)return;const t=e.touches?e.touches[0]:e;dy=Math.max(0,t.clientY-startY);sheet.style.transform='translateY('+dy+'px)';};
  const end=()=>{if(!dragging)return;dragging=false;sheet.classList.remove('sheet-dragging');if(dy>110){haptic(12);onClose();}sheet.style.transform='';};
  zones.forEach(z=>{if(!z)return;z.addEventListener('touchstart',start,{passive:true});z.addEventListener('touchmove',move,{passive:true});z.addEventListener('touchend',end);z.addEventListener('touchcancel',end);});
}
(function initSheetDrag(){
  const drawer=document.getElementById('drawer');
  if(drawer)enableSheetDrag(drawer,[drawer.querySelector('.drawer-handle'),drawer.querySelector('.drawer-header')],closeDrawer);
  const chat=document.getElementById('shionChat');
  if(chat)enableSheetDrag(chat,[chat.querySelector('.sc-head')],scClose);
})();
// 懒加载日历，让开场白能播报"今日在追更新"（命中 SW/API 缓存，不阻塞首屏）
if(USE_WORKER_API&&!lastCalendar){
  fetchCalendar().then(cal=>{if(cal){lastCalendar=cal;setHeroQuote();}}).catch(()=>{});
}
showShionSplash();

// === expose 给 inline HTML onclick 和 community bundle 调用的全局 ===
try { Object.assign(window, { apiFetch, imgSrc, imgLoaded, openWatchUrl, openDrawer, switchView, showToast, shionReact, esc, mascotImg, mascotImgSrc, mascotEmpty }); } catch(e) {}

export {};
