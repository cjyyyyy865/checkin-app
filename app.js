'use strict';

/* ================= 常量与状态 ================= */
const DB_KEY = 'checkin_app_v1';
const EMOJIS = ['🏃','💧','📚','🧘','💪','🦷','🌱','💤','🎸','✍️','🧹','💊','🎯','🍎','☕','🚭','📵','🛁','🎨','📝','🎹','🚶','🚴','⚽','🧠','❤️','🙏','💰','🛒','🐕'];
const COLORS = ['#4f7cff','#ff6b6b','#51cf66','#fcc419','#cc5de8','#22b8cf','#ff922b','#f06595'];
const WEEK = ['一','二','三','四','五','六','日'];
const WALLS = []; // 内置壁纸已移除，背景完全由"管理 → 壁纸 → 从相册添加"（GIF 动图也支持）

let db = load();
let curView = 'today';
let stats = { taskId: 'all', mode: 'month', cursor: fmt(new Date()) };
let confirmCb = null;
let formEmoji = EMOJIS[0], formColor = COLORS[0], formWeekdays = new Set([0,1,2,3,4]);

/* ================= 工具函数 ================= */
function $(s){ return document.querySelector(s); }
function pad(n){ return String(n).padStart(2,'0'); }
function fmt(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parse(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function today(){ return fmt(new Date()); }
function addDays(s, n){ const d = parse(s); d.setDate(d.getDate()+n); return fmt(d); }
function weekdayOf(s){ return (parse(s).getDay()+6)%7; } // 0=周一
function mondayOf(s){ return addDays(s, -weekdayOf(s)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

let toastTimer = null;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

function confetti(){
  const em = ['🎉','✨','🎊','⭐','🥳'];
  for(let i=0;i<18;i++){
    const el = document.createElement('div');
    el.className = 'confetti';
    el.textContent = em[i%em.length];
    el.style.left = (4+Math.random()*92) + 'vw';
    el.style.animationDelay = (Math.random()*0.35) + 's';
    el.style.fontSize = (14+Math.random()*16) + 'px';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 2400);
  }
}

/* ================= 数据持久化 ================= */
function load(){
  try{
    const raw = localStorage.getItem(DB_KEY);
    if(raw){
      const d = JSON.parse(raw);
      return migrate(d);
    }
  }catch(e){ console.warn('数据读取失败，使用初始数据', e); }
  return { tasks:[], rewards:[], exchanges:[], records:{}, coins:0, settings:{ dark:'auto', bg:'anim' }, created: Date.now(),
    templates: seedTemplates(), countdowns: [], userWalls: [] };
}
/* 预置常用任务模板，首次使用即可一键添加 */
function seedTemplates(){
  const t = (name, icon, color, coins, repeat) => ({ id: uid(), name, icon, color, coins, repeat });
  return [
    t('喝水8杯', '💧', '#22b8cf', 1, { type:'daily' }),
    t('阅读30分钟', '📚', '#4f7cff', 3, { type:'daily' }),
    t('运动30分钟', '🏃', '#51cf66', 5, { type:'daily' }),
    t('23点前睡觉', '💤', '#cc5de8', 2, { type:'daily' }),
    t('整理房间', '🧹', '#ff922b', 3, { type:'weekly', weekdays:[5] }),
  ];
}
function migrate(d){
  d.tasks = d.tasks || []; d.rewards = d.rewards || []; d.exchanges = d.exchanges || [];
  d.records = d.records || {}; d.coins = Number(d.coins)||0;
  d.settings = Object.assign({ dark:'auto', bg:'anim' }, d.settings||{});
  d.templates = d.templates || [];
  d.countdowns = d.countdowns || [];
  d.userWalls = d.userWalls || [];
  return d;
}
function save(){ try{ localStorage.setItem(DB_KEY, JSON.stringify(db)); }catch(e){ toast('保存失败：本地存储不可用'); } }

/* ================= 任务/记录逻辑 ================= */
function getTask(id){ return db.tasks.find(t=>t.id===id); }
function scheduledOn(task, date){
  if(!task) return false;
  if(task.repeat.type === 'daily') return true;
  if(task.repeat.type === 'once') return task.repeat.date === date;
  return (task.repeat.weekdays||[]).includes(weekdayOf(date));
}
function getRec(tid, date){ return (db.records[tid]||{})[date] || null; }
function allDatesOf(tid){ return Object.keys(db.records[tid]||{}); }

function toggleCheck(tid, date){
  const task = getTask(tid); if(!task) return;
  const t = today();
  if(date > t){ toast('不能打卡未来的日子哦'); return; }
  const rec = getRec(tid, date);
  if(rec){ applyCheck(tid, date); return; }
  if(task.duration){ askDuration(tid, date); return; }
  applyCheck(tid, date);
}

function applyCheck(tid, date, mins){
  const task = getTask(tid); if(!task) return;
  const t = today();
  const rec = getRec(tid, date);
  if(!db.records[tid]) db.records[tid] = {};
  if(rec){
    delete db.records[tid][date];
    db.coins -= rec.coins || 0;
    toast('已取消打卡' + (rec.coins ? `，- ${rec.coins} 金币` : ''));
  }else{
    const coins = Number(task.coins)||0;
    db.records[tid][date] = { ts: Date.now(), coins, mins: mins||0 };
    db.coins += coins;
    toast(date===t ? `打卡成功 +${coins} 金币 🪙` : `补打卡成功 +${coins} 金币 🪙`);
    if(date === t){
      const list = todayTasks();
      if(list.length && list.every(x=>getRec(x.id,t))) { confetti(); setTimeout(()=>toast('今日全部完成，太棒了！🎉'), 400); }
    }
  }
  save(); renderAll();
}

/* 时长输入弹窗（锻炼了多久之类） */
function askDuration(tid, date){
  const task = getTask(tid); if(!task) return;
  const last = allDatesOf(tid).map(d=>db.records[tid][d]).filter(r=>r&&r.mins).pop();
  const def = last ? last.mins : 30;
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal small">
      <div class="m-title">⏱ ${task.icon} 这次花了多久？</div>
      <div class="dur-chips">${[15,30,45,60,90,120].map(m=>`<button class="btn dur-chip ${m===def?'sel':''}" onclick="pickDur(this,${m})">${m} 分钟</button>`).join('')}</div>
      <div class="coin-input center"><input id="dur-input" type="number" min="1" max="1440" value="${def}"> 分钟</div>
      <div class="m-btns">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" onclick="confirmDuration('${tid}','${date}')">完成打卡</button>
      </div>
    </div></div>`;
}
function pickDur(el, m){ $('#dur-input').value = m; document.querySelectorAll('.dur-chip').forEach(x=>x.classList.toggle('sel', x===el)); }
function confirmDuration(tid, date){
  const mins = clamp(parseInt($('#dur-input').value,10)||0, 1, 1440);
  closeModal();
  applyCheck(tid, date, mins);
  setTimeout(()=>toast(`记录了 ${mins} 分钟 ⏱`), 350);
}

function todayTasks(){
  const t = today();
  return db.tasks.filter(x=>!x.archived && scheduledOn(x, t));
}

/* 连续天数：任务维度。已完成的计 1，排了但没做清零，未排班的日子跳过 */
function taskStreak(tid){
  let s = 0, d = today();
  for(let i=0;i<730;i++){
    const rec = getRec(tid, d);
    if(rec){ s++; }
    else if(scheduledOn(getTask(tid), d)){
      if(d === today()){ /* 今天还没打卡不打断连续 */ }
      else break;
    }
    d = addDays(d, -1);
  }
  return s;
}
/* 总连续天数：所有已排任务全部完成才算一天 */
function overallStreak(){
  let s = 0, d = today();
  for(let i=0;i<730;i++){
    const scheduled = db.tasks.filter(t=>scheduledOn(t,d));
    if(scheduled.length){
      if(scheduled.every(t=>getRec(t.id,d))) s++;
      else if(d !== today()) break;
    }
    d = addDays(d, -1);
  }
  return s;
}

/* ================= 导航 ================= */
let curWall = -1;
function allWalls(){ return WALLS.concat(db.userWalls||[]); }
function setWall(force){
  const walls = allWalls();
  const el = document.querySelector('#bg .bg-img');
  if(!walls.length){ el.style.backgroundImage = ''; return; } // 没有壁纸时显示默认渐变
  let i = Math.floor(Math.random()*walls.length);
  if(!force && i === curWall) i = (i+1)%walls.length;
  curWall = i;
  el.style.backgroundImage = `url('${walls[i]}')`;
}

/* ===== 自定义壁纸：相册选图 → 存本地（GIF 动图保留原样，其他图压缩成 JPEG） ===== */
function addUserWalls(inp){
  const files = inp.files; if(!files || !files.length) return;
  let pending = files.length;
  const trySave = (added) => {
    pending--;
    if(pending) return;
    try{ save(); renderManage(); toast(added ? '壁纸已添加 🖼️' : '没有可添加的图片'); }
    catch(e){
      if((db.userWalls||[]).length){ db.userWalls.pop(); try{ save(); }catch(e2){} }
      renderManage(); toast('存储空间不足，这张放不下了（试试小一点的图）');
    }
    inp.value = '';
  };
  [...files].forEach(f => {
    const reader = new FileReader();
    if(f.type === 'image/gif'){
      // GIF 动图不做压缩，保留动画原样存入
      reader.onload = () => { (db.userWalls = db.userWalls||[]).push(reader.result); trySave(true); };
      reader.onerror = () => trySave(false);
      reader.readAsDataURL(f);
    }else{
      reader.onload = () => compressImage(reader.result, url => { (db.userWalls = db.userWalls||[]).push(url); trySave(true); });
      reader.onerror = () => trySave(false);
      reader.readAsDataURL(f);
    }
  });
}
function compressImage(dataUrl, cb){
  const img = new Image();
  img.onload = () => {
    const max = 1600;
    let w = img.width, h = img.height;
    if(Math.max(w,h) > max){ const k = max/Math.max(w,h); w = Math.round(w*k); h = Math.round(h*k); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(c.toDataURL('image/jpeg', .82));
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}
function deleteUserWall(i){
  confirmDlg('删除壁纸', '确定删除这张自定义壁纸吗？', ()=>{
    db.userWalls.splice(i,1); save(); renderManage();
  });
}
function useWallNow(i){
  curWall = WALLS.length + i;
  document.querySelector('#bg .bg-img').style.backgroundImage = `url('${db.userWalls[i]}')`;
  toast('已设为当前背景');
}
function switchView(v){
  curView = v;
  setWall();
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  $('#view-'+v).classList.add('active');
  document.querySelectorAll('#tabbar .tab').forEach(el=>el.classList.toggle('active', el.dataset.view===v));
  renderAll();
  window.scrollTo(0,0);
}

function renderAll(){
  applyDark();
  renderToday(); renderStats(); renderShop(); renderManage();
}

/* ================= 今日视图 ================= */
function fmtMins(m){
  m = Math.round(m||0);
  if(m >= 60){ const h = Math.floor(m/60), r = m%60; return r ? `${h}h${r}m` : `${h}h`; }
  return m + 'm';
}
function daysUntil(date){
  return Math.round((parse(date) - parse(today()))/86400000);
}

function renderToday(){
  const t = today();
  const list = todayTasks();
  const done = list.filter(x=>getRec(x.id,t)).length;
  const pct = list.length ? Math.round(done/list.length*100) : 0;
  const d = parse(t);
  const wd = '周' + '日一二三四五六'[d.getDay()];

  let html = `
  <div class="hero-card">
    <div class="hero-top">
      <div>
        <div class="hero-date">${d.getMonth()+1}月${d.getDate()}日</div>
        <div class="hero-sub">${wd} · ${list.length ? '还有 '+Math.max(0,list.length-done)+' 个任务' : '今天没有安排'}</div>
      </div>
      <div class="coin-chip">🪙 ${db.coins}</div>
    </div>
    <div class="progress-line"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="hero-bottom">
      <span>今日完成 ${done}/${list.length}</span>
      <span>🔥 连续 ${overallStreak()} 天</span>
    </div>
  </div>`;

  /* 倒数日 */
  if(db.countdowns.length){
    const sorted = db.countdowns.slice().sort((a,b)=>{
      const da=Math.abs(daysUntil(a.date)), dbb=Math.abs(daysUntil(b.date));
      return da-dbb;
    });
    html += `<div class="cd-row">` + sorted.map(c=>{
      const n = daysUntil(c.date);
      const txt = n>0 ? `还有 ${n} 天` : (n===0 ? '就是今天！' : `已过 ${-n} 天`);
      const cls = n===0 ? 'today' : (n>0 ? 'future' : 'past');
      return `<div class="cd-card glass ${cls}" onclick="openCdForm('${c.id}')">
        <div class="cd-ico">${c.icon}</div>
        <div class="cd-name">${esc(c.name)}</div>
        <div class="cd-num">${txt}</div>
      </div>`;
    }).join('') + `<button class="cd-add" onclick="openCdForm()">＋</button></div>`;
  }

  if(!db.tasks.length && !db.templates.length){
    html += `<div class="empty">
      <div class="empty-icon">📝</div>
      <p>还没有任务，先创建一个吧</p>
      <button class="btn primary" onclick="switchView('manage')">去创建任务</button>
    </div>`;
  }else{
    if(!list.length && db.tasks.length){
      html += `<div class="empty small"><div class="empty-icon">☕</div><p>今天没有需要打卡的任务，休息一下吧～</p></div>`;
    }
    html += list.map(x=>{
      const rec = getRec(x.id, t);
      const st = taskStreak(x.id);
      const rep = x.repeat.type==='weekly'
        ? ` <span class="mini-tag">${(x.repeat.weekdays||[]).map(i=>WEEK[i]).join(' ')}</span>`
        : (x.repeat.type==='once' ? ' <span class="mini-tag">临时</span>' : '');
      const durMeta = x.duration ? (rec && rec.mins ? ` 　⏱ ${fmtMins(rec.mins)}` : ' 　⏱ 记录时长') : '';
      return `<div class="task-card ${rec?'done':''}" style="--c:${x.color}" onclick="toggleCheck('${x.id}','${t}')">
        <div class="task-icon">${x.icon}</div>
        <div class="task-info">
          <div class="task-name">${esc(x.name)}${rep}</div>
          <div class="task-meta">🪙 +${x.coins} 　🔥 连续 ${st} 天${durMeta}</div>
        </div>
        <div class="check-circle ${rec?'checked':''}">${rec?'✓':''}</div>
      </div>`;
    }).join('');
    html += `<button class="add-dashed" onclick="quickAdd()">＋ 添加任务</button>`;
  }
  $('#today-list').innerHTML = html;
}

/* ================= 统计视图 ================= */
function statsTasks(){
  return db.tasks.filter(t=>!t.archived || allDatesOf(t.id).length);
}
function setStatsTask(id){ stats.taskId = id; renderStats(); }
function setStatsMode(m){ stats.mode = m; renderStats(); }
function statsGo(delta){
  const c = parse(stats.cursor);
  if(stats.mode==='day') c.setDate(c.getDate()+delta);
  else if(stats.mode==='week') c.setDate(c.getDate()+delta*7);
  else if(stats.mode==='month') c.setMonth(c.getMonth()+delta);
  else c.setFullYear(c.getFullYear()+delta);
  stats.cursor = fmt(c); renderStats();
}
function statsTapDay(date){ if(stats.mode!=='day'){ stats.mode='day'; stats.cursor=date; renderStats(); } }

function statsRange(){
  const c = stats.cursor;
  if(stats.mode==='day') return [c];
  if(stats.mode==='week'){ const m = mondayOf(c); return Array.from({length:7},(_,i)=>addDays(m,i)); }
  const d = parse(c);
  if(stats.mode==='month'){
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    return Array.from({length:last},(_,i)=>fmt(new Date(d.getFullYear(), d.getMonth(), i+1)));
  }
  return [];
}

function statsSummary(dates){
  const t = today();
  const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
  let times=0, sched=0, coins=0, mins=0;
  for(const date of dates){
    if(date > t) continue;
    for(const task of sel){
      const rec = getRec(task.id, date);
      if(rec){ times++; coins += rec.coins||0; mins += rec.mins||0; }
      if(scheduledOn(task, date)) sched++;
    }
  }
  // 最长连续
  let maxS=0, cur=0, d = dates.length ? dates[0] : today();
  for(let i=0;i<730;i++){
    const date = addDays(d, i); if(date > t) break;
    const doneList = sel.filter(x=>getRec(x.id,date));
    const schedList = sel.filter(x=>scheduledOn(x,date));
    let counts=false, breaks=false;
    if(stats.taskId==='all'){
      if(schedList.length){ if(doneList.length===schedList.length) counts=true; else breaks=true; }
    }else{
      if(doneList.length) counts=true;
      if(schedList.length && !doneList.length) breaks=true;
    }
    if(counts){ cur++; maxS=Math.max(maxS,cur); }
    else if(breaks){ cur=0; }
  }
  return { times, sched, coins, mins, rate: sched? Math.round(times/sched*100):0, maxS };
}

function renderStats(){
  // 任务筛选 chips
  const chips = [{id:'all', icon:'📊', name:'全部'}].concat(statsTasks().map(t=>({id:t.id, icon:t.icon, name:t.name})));
  $('#stat-chips').innerHTML = chips.map(c=>
    `<button class="chip ${stats.taskId===c.id?'active':''}" onclick="setStatsTask('${c.id}')">${c.icon} ${esc(c.name)}</button>`).join('');
  // 模式
  $('#stat-modes').innerHTML = [['day','日'],['week','周'],['month','月'],['year','年']].map(([k,l])=>
    `<button class="seg-btn ${stats.mode===k?'active':''}" onclick="setStatsMode('${k}')">${l}</button>`).join('');

  const c = parse(stats.cursor);
  let label = '';
  if(stats.mode==='day') label = `${c.getFullYear()}年${c.getMonth()+1}月${c.getDate()}日`;
  else if(stats.mode==='week'){ const m = mondayOf(stats.cursor); label = `${m.slice(0,4).replace(/-/g,'年')}周：${m.slice(5).replace('-','/')} ~ ${addDays(m,6).slice(5).replace('-','/')}`; }
  else if(stats.mode==='month') label = `${c.getFullYear()}年${c.getMonth()+1}月`;
  else label = `${c.getFullYear()}年`;

  const isYear = stats.mode==='year';
  let dates = [];
  if(isYear){
    // 年视图：12 个月，每月取该月日期参与汇总
    for(let m=0;m<12;m++){
      const last = new Date(c.getFullYear(), m+1, 0).getDate();
      dates = dates.concat(Array.from({length:last},(_,i)=>fmt(new Date(c.getFullYear(), m, i+1))));
    }
  }else{
    dates = statsRange();
  }
  const s = statsSummary(dates);
  $('#stat-label').textContent = label;
  $('#stat-summary').innerHTML = `
    <div class="sum-grid">
      <div class="sum-card"><div class="sum-num">${s.times}</div><div class="sum-label">打卡次数</div></div>
      <div class="sum-card"><div class="sum-num">${s.rate}%</div><div class="sum-label">完成率</div></div>
      <div class="sum-card"><div class="sum-num">${fmtMins(s.mins)}</div><div class="sum-label">总时长</div></div>
      <div class="sum-card"><div class="sum-num">${s.maxS}</div><div class="sum-label">最长连续(天)</div></div>
    </div>`;

  const main = isYear ? renderYear(c.getFullYear(), dates) : renderPeriod(dates);
  const dur = isYear ? renderDurChart(c.getFullYear()) : (stats.mode==='day' ? '' : renderDurSection(dates));
  $('#stat-body').innerHTML = main + dur;
}

/* ===== 时长统计图（折线+柱状） ===== */
function durChartSVG(vals, labels){
  const W=320, H=132, PAD=20;
  const max = Math.max(1, ...vals);
  const n = vals.length;
  const bw = (W-PAD*2)/n;
  let bars = '', pts = [];
  vals.forEach((v,i)=>{
    const h = v/max*(H-40);
    const x = PAD + i*bw, y = H-26-h;
    if(v>0) bars += `<rect x="${(x+bw*0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3.5,bw*0.3)}" class="chart-bar"/>`;
    pts.push([(x+bw/2).toFixed(1), y.toFixed(1)]);
  });
  const line = `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" class="chart-line"/>`;
  const dots = pts.filter((p,i)=>vals[i]>0).map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="2.6" class="chart-dot"/>`).join('');
  const step = Math.max(1, Math.ceil(n/8));
  const txt = labels.map((l,i)=> (i%step===0 || i===n-1) ? `<text x="${pts[i][0]}" y="${H-10}" text-anchor="middle" class="chart-txt">${l}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="dur-chart" preserveAspectRatio="none">${bars}${line}${dots}${txt}</svg>`;
}

function renderDurSection(dates){
  const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
  const t = today();
  const vals = dates.map(date=>{
    if(date > t) return 0;
    return sel.reduce((s,task)=> s + ((getRec(task.id,date)||{}).mins||0), 0);
  });
  const labels = dates.map(d=> stats.mode==='week' ? WEEK[weekdayOf(d)] : String(parse(d).getDate()));
  const total = vals.reduce((a,b)=>a+b,0);
  const title = stats.taskId==='all' ? '时长统计' : getTask(stats.taskId) ? getTask(stats.taskId).name + ' 时长' : '时长统计';
  if(!total) return '';
  return `<div class="sec-title">⏱ ${title} <span class="sec-sub">共 ${fmtMins(total)}</span></div>
    <div class="glass chart-wrap">${durChartSVG(vals, labels)}
    <div class="chart-legend"><span><i class="lg-bar"></i>每日时长（柱）</span><span><i class="lg-line"></i>趋势（线）</span></div></div>`;
}

function renderDurChart(year){
  const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
  const t = today();
  const vals = [], labels = [];
  for(let m=0;m<12;m++){
    let mins = 0;
    const last = new Date(year, m+1, 0).getDate();
    for(let i=1;i<=last;i++){
      const date = fmt(new Date(year, m, i));
      if(date > t) break;
      mins += sel.reduce((s,task)=> s + ((getRec(task.id,date)||{}).mins||0), 0);
    }
    vals.push(mins); labels.push((m+1)+'月');
  }
  const total = vals.reduce((a,b)=>a+b,0);
  if(!total) return '';
  return `<div class="sec-title">⏱ 年度时长 <span class="sec-sub">共 ${fmtMins(total)}</span></div>
    <div class="glass chart-wrap">${durChartSVG(vals, labels)}
    <div class="chart-legend"><span><i class="lg-bar"></i>每月时长（柱）</span><span><i class="lg-line"></i>趋势（线）</span></div></div>`;
}

function renderYear(year){
  const t = today();
  const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
  const bars = [];
  for(let m=0;m<12;m++){
    const last = new Date(year, m+1, 0).getDate();
    let sched=0, done=0;
    for(let i=1;i<=last;i++){
      const date = fmt(new Date(year, m, i)); if(date > t) continue;
      for(const task of sel){
        if(getRec(task.id,date)) done++;
        if(scheduledOn(task,date)) sched++;
      }
    }
    bars.push({ m, pct: sched? Math.round(done/sched*100):0, done, sched });
  }
  const max = Math.max(1, ...bars.map(b=>b.done));
  return `<div class="bar-chart">` + bars.map(b=>`
    <div class="bar-col" onclick="stats.cursor='${year}-${pad(b.m+1)}-01';stats.mode='month';renderStats()">
      <div class="bar-v">${b.done}</div>
      <div class="bar" title="完成 ${b.done}/${b.sched}">
        <div class="bar-fill" style="height:${Math.round(b.done/max*100)}%"></div>
      </div>
      <div class="bar-l">${b.m+1}月</div>
    </div>`).join('') + `</div>
    <p class="hint">点击月份查看当月日历</p>`;
}

function renderPeriod(dates){
  const t = today();
  if(stats.mode==='day'){
    const date = dates[0];
    const scheduled = db.tasks.filter(x=>scheduledOn(x,date));
    if(!scheduled.length) return `<div class="empty small"><p>这天没有安排任务</p></div>`;
    return `<div class="day-list">` + scheduled.map(x=>{
      const rec = getRec(x.id, date);
      return `<div class="day-row ${rec?'ok':(date<=t?'miss':'')}" onclick="toggleCheck('${x.id}','${date}')">
        <span class="day-ico">${x.icon}</span>
        <span class="day-name">${esc(x.name)}</span>
        <span class="day-status">${rec?'✓ 已完成'+(rec.mins?` · ⏱${fmtMins(rec.mins)}`:''):(date<=t?'✗ 未打卡':'未到')}</span>
      </div>`;
    }).join('') + `</div>
    <p class="hint">点击可打卡 / 取消（可补历史打卡）</p>`;
  }
  if(stats.mode==='week'){
    const max = 1;
    return `<div class="bar-chart">` + dates.map(date=>{
      const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
      const schedList = sel.filter(x=>scheduledOn(x,date));
      const done = sel.filter(x=>getRec(x.id,date)).length;
      const sched = Math.max(schedList.length,1);
      const pct = Math.round(done/sched*100);
      return `<div class="bar-col" onclick="statsTapDay('${date}')">
        <div class="bar-v">${done}</div>
        <div class="bar"><div class="bar-fill" style="height:${pct}%"></div></div>
        <div class="bar-l">${WEEK[weekdayOf(date)]}</div>
      </div>`;
    }).join('') + `</div>
    <p class="hint">点击某天查看明细</p>`;
  }
  // 月历热力图
  const first = dates[0], lead = weekdayOf(first);
  let cells = Array.from({length:lead},()=>'<div class="cell blank"></div>');
  cells = cells.concat(dates.map(date=>{
    const sel = stats.taskId==='all' ? db.tasks : db.tasks.filter(x=>x.id===stats.taskId);
    const schedList = sel.filter(x=>scheduledOn(x,date));
    const done = sel.filter(x=>getRec(x.id,date)).length;
    let cls = 'cell';
    if(date > t) cls += ' future';
    else if(schedList.length && done===schedList.length) cls += ' full';
    else if(done>0) cls += ' part';
    else if(schedList.length) cls += ' miss';
    const d = parse(date);
    return `<div class="${cls}" onclick="statsTapDay('${date}')">${d.getDate()}</div>`;
  }));
  return `<div class="cal-week">` + WEEK.map(w=>`<div class="cal-wl">${w}</div>`).join('') + `</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="legend">
      <span><i class="dot full"></i>全部完成</span><span><i class="dot part"></i>部分完成</span>
      <span><i class="dot miss"></i>未完成</span><span><i class="dot"></i>未安排</span>
    </div>
    <p class="hint">点击日期查看 / 补打卡</p>`;
}

/* ================= 奖品视图 ================= */
function renderShop(){
  let html = `<div class="hero-card shop-balance">
    <div class="hero-top"><div><div class="hero-date">🪙 ${db.coins}</div><div class="hero-sub">当前金币余额</div></div></div>
  </div>
  <div class="sec-title">奖品清单 <button class="btn small" onclick="openRewardForm()">+ 添加奖品</button></div>`;

  if(!db.rewards.length){
    html += `<div class="empty small"><div class="empty-icon">🎁</div><p>还没有奖品，添加一个作为打卡目标吧</p></div>`;
  }else{
    html += `<div class="reward-grid">` + db.rewards.map(r=>`
      <div class="reward-card">
        <div class="reward-icon">${r.icon}</div>
        <div class="reward-name">${esc(r.name)}</div>
        <div class="reward-cost">🪙 ${r.cost}</div>
        <button class="btn primary small ${db.coins < r.cost ? 'disabled':''}" onclick="exchangeReward('${r.id}')">兑换</button>
        <div class="reward-ops">
          <span onclick="openRewardForm('${r.id}')">编辑</span>·<span onclick="deleteReward('${r.id}')">删除</span>
        </div>
      </div>`).join('') + `</div>`;
  }

  html += `<div class="sec-title">兑换记录</div>`;
  if(!db.exchanges.length){
    html += `<div class="empty small"><p>还没有兑换记录，攒够金币就来换奖励吧！</p></div>`;
  }else{
    html += db.exchanges.slice().reverse().map(e=>`
      <div class="history-row"><span class="day-ico">${e.icon}</span>
        <span class="day-name">${esc(e.name)}</span>
        <span class="day-status cost">-${e.cost} 🪙</span>
        <span class="history-time">${new Date(e.ts).toLocaleDateString('zh-CN')}</span>
      </div>`).join('');
  }
  $('#shop-list').innerHTML = html;
}

function exchangeReward(id){
  const r = db.rewards.find(x=>x.id===id); if(!r) return;
  if(db.coins < r.cost){ toast('金币不足，继续加油打卡！'); return; }
  confirmDlg('兑换奖品', `确定用 ${r.cost} 金币兑换「${esc(r.name)}」吗？`, ()=>{
    db.coins -= r.cost;
    db.exchanges.push({ id: uid(), rewardId: r.id, name: r.name, icon: r.icon, cost: r.cost, ts: Date.now() });
    save(); renderAll(); confetti(); toast('兑换成功，好好享受奖励！🎁');
  });
}
function deleteReward(id){
  const r = db.rewards.find(x=>x.id===id); if(!r) return;
  confirmDlg('删除奖品', `确定删除「${esc(r.name)}」吗？兑换记录会保留。`, ()=>{
    db.rewards = db.rewards.filter(x=>x.id!==id); save(); renderShop();
  });
}

/* ================= 管理视图 ================= */
function renderManage(){
  let html = `<div class="sec-title">我的任务
    <span><button class="btn small" onclick="quickAdd()">⚡ 快速添加</button>
    <button class="btn primary small" onclick="openTaskForm()">+ 新建任务</button></span></div>`;
  if(!db.tasks.length){
    html += `<div class="empty small"><p>还没有任务，点击右上角新建，或从常用模板一键添加</p></div>`;
  }else{
    html += db.tasks.map(t=>{
      const total = allDatesOf(t.id).length;
      const rep = t.repeat.type==='daily' ? '每天'
        : t.repeat.type==='once' ? `临时 · ${t.repeat.date.slice(5).replace('-','/')} 一次`
        : '每周' + (t.repeat.weekdays||[]).map(i=>WEEK[i]).join(' ');
      return `<div class="task-card manage ${t.archived?'archived':''}" style="--c:${t.color}">
        <div class="task-icon">${t.icon}</div>
        <div class="task-info">
          <div class="task-name">${esc(t.name)} ${t.archived?'<span class="mini-tag">已停用</span>':''}</div>
          <div class="task-meta">${rep} 　🪙 +${t.coins} 　累计 ${total} 次</div>
        </div>
        <div class="task-ops">
          <span onclick="toggleArchive('${t.id}')">${t.archived?'启用':'停用'}</span>·
          <span onclick="openTaskForm('${t.id}')">编辑</span>·
          <span onclick="deleteTask('${t.id}')">删除</span>
        </div>
      </div>`;
    }).join('');
  }

  if(db.templates.length){
    html += `<div class="sec-title">常用模板 <span class="sec-sub">点击即可添加为任务</span></div>
    <div class="settings-card">
      ${db.templates.map(tp=>`
      <div class="set-row tpl-row" onclick="addFromTemplate('${tp.id}')">
        <span class="day-ico">${tp.icon}</span>
        <span class="tpl-name">${esc(tp.name)}</span>
        <span class="day-status">${repeatText(tp.repeat)} · +${tp.coins}🪙</span>
        <span class="link-danger" onclick="event.stopPropagation();deleteTemplate('${tp.id}')">删除</span>
      </div>`).join('')}
    </div>`;
  }

  html += `<div class="sec-title">壁纸 <span class="sec-sub">已添加 ${allWalls().length} 张 · 切页随机换（支持 GIF 动图）</span></div>
  <div class="settings-card">
    <div class="set-row ops">
      <button class="btn small primary" onclick="$('#wall-file').click()">+ 从相册添加图片</button>
      <input type="file" id="wall-file" accept="image/*" multiple style="display:none" onchange="addUserWalls(this)">
    </div>
    ${(db.userWalls||[]).length ? `<div class="wall-grid">
      ${db.userWalls.map((w,i)=>`<div class="wall-thumb" style="background-image:url('${w}')" onclick="useWallNow(${i})">
        <span class="wall-del" onclick="event.stopPropagation();deleteUserWall(${i})">×</span>
      </div>`).join('')}
    </div>
    <p class="hint" style="margin:0 0 10px">点缩略图立即使用，点 × 删除；GIF 会保留动画效果</p>` : `<p class="hint" style="margin:0 0 10px">还没有壁纸，从相册挑几张喜欢的加进来吧（静态图会自动压缩，GIF 动图保留原样）</p>`}
  </div>

  <div class="sec-title">设置</div>
  <div class="settings-card">
    <div class="set-row"><span>深色模式</span>
      <select onchange="setDark(this.value)">
        <option value="auto" ${db.settings.dark==='auto'?'selected':''}>跟随系统</option>
        <option value="light" ${db.settings.dark==='light'?'selected':''}>浅色</option>
        <option value="dark" ${db.settings.dark==='dark'?'selected':''}>深色</option>
      </select>
    </div>
    <div class="set-row"><span>背景</span>
      <select onchange="setBg(this.value)">
        <option value="anim" ${(db.settings.bg||'anim')==='anim'?'selected':''}>动态（轻柔缩放）</option>
        <option value="static" ${db.settings.bg==='static'?'selected':''}>静态图片</option>
        <option value="off" ${db.settings.bg==='off'?'selected':''}>关闭（更省电）</option>
      </select>
    </div>
    <div class="set-row ops">
      <button class="btn small" onclick="exportData()">导出数据</button>
      <button class="btn small" onclick="$('#import-file').click()">导入数据</button>
      <button class="btn small danger" onclick="clearAll()">清空数据</button>
      <input type="file" id="import-file" accept=".json" style="display:none" onchange="importData(this)">
    </div>
  </div>
  <p class="hint center">打卡小助手 · 数据仅保存在本机浏览器中<br>换手机前记得先导出备份</p>`;
  $('#manage-list').innerHTML = html;
}

function toggleArchive(id){
  const t = getTask(id); if(!t) return;
  t.archived = !t.archived; save(); renderAll();
}
function deleteTask(id){
  const t = getTask(id); if(!t) return;
  const total = allDatesOf(id).length;
  confirmDlg('删除任务', `确定删除「${esc(t.name)}」吗？${total?`其 ${total} 条打卡记录也会删除，`:''}此操作不可恢复。`, ()=>{
    db.tasks = db.tasks.filter(x=>x.id!==id);
    delete db.records[id];
    save(); renderAll();
  });
}

/* ================= 表单弹窗 ================= */
function closeModal(){ $('#modal-root').innerHTML = ''; }
function confirmDlg(title, msg, cb){
  confirmCb = cb;
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal small">
      <div class="m-title">${title}</div>
      <div class="m-body">${msg}</div>
      <div class="m-btns"><button class="btn" onclick="closeModal()">取消</button>
      <button class="btn primary" onclick="confirmOk()">确定</button></div>
    </div></div>`;
}
function confirmOk(){ const cb = confirmCb; confirmCb = null; closeModal(); if(cb) cb(); }

function repeatText(rep){
  if(!rep) return '';
  if(rep.type==='daily') return '每天';
  if(rep.type==='once') return '仅一次';
  return '每周' + (rep.weekdays||[]).map(i=>WEEK[i]).join(' ');
}

function openTaskForm(id, presetOnce){
  const t = id ? getTask(id) : null;
  formEmoji = t ? t.icon : EMOJIS[Math.floor(Math.random()*EMOJIS.length)];
  formColor = t ? t.color : COLORS[db.tasks.length % COLORS.length];
  formWeekdays = new Set(t && t.repeat.type==='weekly' ? t.repeat.weekdays : [0,1,2,3,4]);
  const repType = presetOnce ? 'once' : (t ? t.repeat.type : 'daily');
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="m-title">${t?'编辑任务':'新建任务'}</div>
      <div class="form">
        <label>名称</label>
        <input id="f-name" type="text" maxlength="20" placeholder="例如：每天喝 8 杯水" value="${t?esc(t.name):''}">
        <label>图标</label>
        <div class="emoji-grid" id="f-emojis">${EMOJIS.map(e=>`<span class="emoji ${e===formEmoji?'sel':''}" data-e="${e}" onclick="pickEmoji(this)">${e}</span>`).join('')}</div>
        <label>颜色</label>
        <div class="color-row" id="f-colors">${COLORS.map(c=>`<span class="color ${c===formColor?'sel':''}" data-c="${c}" style="background:${c}" onclick="pickColor(this)"></span>`).join('')}</div>
        <label>每次打卡奖励</label>
        <div class="coin-input">🪙 <input id="f-coins" type="number" min="0" max="999" value="${t?t.coins:1}"> 金币</div>
        <label>重复</label>
        <div class="seg" id="f-rep">
          <button type="button" class="seg-btn ${repType==='daily'?'active':''}" data-v="daily" onclick="pickRep(this)">每天</button>
          <button type="button" class="seg-btn ${repType==='weekly'?'active':''}" data-v="weekly" onclick="pickRep(this)">每周几</button>
          <button type="button" class="seg-btn ${repType==='once'?'active':''}" data-v="once" onclick="pickRep(this)">仅一次</button>
        </div>
        <div class="wd-row" id="f-wds" style="display:${repType==='weekly'?'flex':'none'}">
          ${WEEK.map((w,i)=>`<span class="wd ${formWeekdays.has(i)?'sel':''}" data-i="${i}" onclick="pickWd(this)">${w}</span>`).join('')}
        </div>
        <div id="f-once-row" style="display:${repType==='once'?'block':'none'};margin-top:8px">
          <input id="f-once" type="date" value="${t && t.repeat.type==='once' ? t.repeat.date : today()}">
          <p class="hint" style="margin:6px 0 0;text-align:left">临时任务只在这一天出现，适合一次性事项</p>
        </div>
        <label class="tpl-check"><input type="checkbox" id="f-dur" ${t&&t.duration?'checked':''}> ⏱ 记录时长（打卡时输入分钟，如锻炼了多久）</label>
        ${t?'':`<label class="tpl-check"><input type="checkbox" id="f-tpl" checked> 存为常用模板，下次一键添加</label>`}
        <div class="m-btns">
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn primary" onclick="saveTask('${id||''}')">保存</button>
        </div>
      </div>
    </div></div>`;
  setTimeout(()=>{ const el=$('#f-name'); if(el && !t) el.focus(); }, 50);
}
function pickEmoji(el){ formEmoji = el.dataset.e; document.querySelectorAll('#f-emojis .emoji').forEach(x=>x.classList.toggle('sel', x===el)); }
function pickColor(el){ formColor = el.dataset.c; document.querySelectorAll('#f-colors .color').forEach(x=>x.classList.toggle('sel', x===el)); }
function pickRep(el){
  document.querySelectorAll('#f-rep .seg-btn').forEach(x=>x.classList.toggle('active', x===el));
  $('#f-wds').style.display = el.dataset.v==='weekly' ? 'flex' : 'none';
  $('#f-once-row').style.display = el.dataset.v==='once' ? 'block' : 'none';
}
function pickWd(el){
  const i = Number(el.dataset.i);
  if(formWeekdays.has(i)) formWeekdays.delete(i); else formWeekdays.add(i);
  el.classList.toggle('sel');
}
function saveTask(id){
  const name = $('#f-name').value.trim();
  if(!name){ toast('请填写任务名称'); return; }
  const coins = clamp(parseInt($('#f-coins').value,10)||0, 0, 999);
  const type = document.querySelector('#f-rep .seg-btn.active').dataset.v;
  let repeat;
  if(type==='daily'){ repeat = { type:'daily' }; }
  else if(type==='weekly'){
    if(!formWeekdays.size){ toast('请至少选择一个星期几'); return; }
    repeat = { type:'weekly', weekdays:[...formWeekdays].sort() };
  }else{
    repeat = { type:'once', date: $('#f-once').value || today() };
  }
  const duration = !!(document.getElementById('f-dur') && document.getElementById('f-dur').checked);
  if($('#f-tpl') && $('#f-tpl').checked){
    const exist = db.templates.find(x=>x.name===name);
    if(exist) Object.assign(exist, { icon: formEmoji, color: formColor, coins, repeat, duration });
    else db.templates.push({ id: uid(), name, icon: formEmoji, color: formColor, coins, repeat, duration });
  }
  if(id){
    const t = getTask(id);
    Object.assign(t, { name, icon: formEmoji, color: formColor, coins, repeat, duration });
  }else{
    db.tasks.push({ id: uid(), name, icon: formEmoji, color: formColor, coins, repeat, duration, archived:false, createdAt: Date.now() });
  }
  save(); closeModal(); renderAll(); toast('已保存');
}

/* ===== 快速添加（模板一键添加 / 临时任务）===== */
function quickAdd(){
  const tplHtml = db.templates.length
    ? db.templates.map(tp=>`
      <button class="tpl-chip" onclick="addFromTemplate('${tp.id}')">
        <span class="tpl-ico">${tp.icon}</span>
        <span class="tpl-name">${esc(tp.name)}</span>
        <span class="tpl-meta">+${tp.coins}🪙 ${repeatText(tp.repeat)}${tp.duration?' ⏱':''}</span>
      </button>`).join('')
    : `<p class="hint">还没有常用模板，新建任务时勾选"存为常用模板"，以后就能一键添加</p>`;
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="m-title">添加任务</div>
      <div class="tpl-list">${tplHtml}</div>
      <div class="qa-btns">
        <button class="btn" onclick="openTaskForm(null, true)">⚡ 临时任务</button>
        <button class="btn primary" onclick="openTaskForm()">+ 新建任务</button>
      </div>
    </div></div>`;
}
function instantiateRepeat(rep){
  return rep.type==='once' ? { type:'once', date: today() } : JSON.parse(JSON.stringify(rep));
}
function addFromTemplate(tid){
  const tp = db.templates.find(x=>x.id===tid); if(!tp) return;
  const active = db.tasks.find(t=>t.name===tp.name && !t.archived);
  if(active){ closeModal(); toast('该任务已在列表中'); return; }
  const arch = db.tasks.find(t=>t.name===tp.name && t.archived);
  if(arch){
    Object.assign(arch, { icon: tp.icon, color: tp.color, coins: tp.coins, repeat: instantiateRepeat(tp.repeat), archived:false });
    save(); closeModal(); renderAll(); toast(`已重新启用「${tp.name}」`); return;
  }
  db.tasks.push({ id: uid(), name: tp.name, icon: tp.icon, color: tp.color, coins: tp.coins, repeat: instantiateRepeat(tp.repeat), archived:false, createdAt: Date.now() });
  save(); closeModal(); renderAll(); toast(`已添加「${tp.name}」`);
}
function deleteTemplate(tid){
  const tp = db.templates.find(x=>x.id===tid); if(!tp) return;
  confirmDlg('删除模板', `确定删除常用模板「${esc(tp.name)}」吗？不影响已添加的任务。`, ()=>{
    db.templates = db.templates.filter(x=>x.id!==tid); save(); renderManage();
  });
}

/* ===== 倒数日 ===== */
const CD_ICONS = ['🎯','📅','✈️','🎓','💼','🎂','💍','🏠','🚗','🏆','🏖️','🎬','❤️','🐣','🌸','⭐'];
function openCdForm(id){
  const c = id ? db.countdowns.find(x=>x.id===id) : null;
  const icon = c ? c.icon : '🎯';
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="m-title">${c?'编辑倒数日':'新增倒数日'}</div>
      <div class="form">
        <label>事项</label>
        <input id="cd-name" type="text" maxlength="15" placeholder="例如：考研 / 生日 / 出发去旅行" value="${c?esc(c.name):''}">
        <label>图标</label>
        <div class="emoji-grid" id="cd-emojis">${CD_ICONS.map(e=>`<span class="emoji ${e===icon?'sel':''}" data-e="${e}" onclick="pickCdEmoji(this)">${e}</span>`).join('')}</div>
        <label>目标日期</label>
        <input id="cd-date" type="date" value="${c?c.date:today()}">
        <div class="m-btns">
          ${c?'<button class="btn danger" onclick="deleteCd(\''+c.id+'\')">删除</button>':''}
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn primary" onclick="saveCd('${id||''}')">保存</button>
        </div>
      </div>
    </div></div>`;
}
let cdIcon = '🎯';
function pickCdEmoji(el){ cdIcon = el.dataset.e; document.querySelectorAll('#cd-emojis .emoji').forEach(x=>x.classList.toggle('sel', x===el)); }
function saveCd(id){
  const name = $('#cd-name').value.trim();
  if(!name){ toast('请填写事项名称'); return; }
  const date = $('#cd-date').value || today();
  if(id){ Object.assign(db.countdowns.find(x=>x.id===id), { name, icon: cdIcon, date }); }
  else db.countdowns.push({ id: uid(), name, icon: cdIcon, date });
  save(); closeModal(); renderToday(); toast('已保存 ⏳');
}
function deleteCd(id){
  confirmCb = null;
  confirmDlg('删除倒数日', '确定删除这个倒数日吗？', ()=>{
    db.countdowns = db.countdowns.filter(x=>x.id!==id); save(); renderToday();
  });
}

function openRewardForm(id){
  const r = id ? db.rewards.find(x=>x.id===id) : null;
  const icon = r ? r.icon : '🎁';
  $('#modal-root').innerHTML = `<div class="mask" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="m-title">${r?'编辑奖品':'添加奖品'}</div>
      <div class="form">
        <label>奖品名称</label>
        <input id="r-name" type="text" maxlength="20" placeholder="例如：看一场电影" value="${r?esc(r.name):''}">
        <label>图标</label>
        <div class="emoji-grid" id="r-emojis">${['🎁','🎬','🍰','🍦','🍗','🎮','🧸','💄','👟','📱','🧋','🍕','🎫','🏖️','💻','💡'].map(e=>`<span class="emoji ${e===icon?'sel':''}" data-e="${e}" onclick="pickREmoji(this)">${e}</span>`).join('')}</div>
        <label>所需金币</label>
        <div class="coin-input">🪙 <input id="r-cost" type="number" min="1" max="99999" value="${r?r.cost:10}"> 金币</div>
        <div class="m-btns">
          <button class="btn" onclick="closeModal()">取消</button>
          <button class="btn primary" onclick="saveReward('${id||''}')">保存</button>
        </div>
      </div>
    </div></div>`;
}
let rewardIcon = '🎁';
function pickREmoji(el){ rewardIcon = el.dataset.e; document.querySelectorAll('#r-emojis .emoji').forEach(x=>x.classList.toggle('sel', x===el)); }
function saveReward(id){
  const name = $('#r-name').value.trim();
  if(!name){ toast('请填写奖品名称'); return; }
  const cost = clamp(parseInt($('#r-cost').value,10)||0, 1, 99999);
  if(id){ const r = db.rewards.find(x=>x.id===id); Object.assign(r, { name, icon: rewardIcon, cost }); }
  else db.rewards.push({ id: uid(), name, icon: rewardIcon, cost });
  save(); closeModal(); renderShop(); toast('已保存');
}

/* ================= 数据导入导出与设置 ================= */
function exportData(){
  const blob = new Blob([JSON.stringify(db, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `打卡备份-${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
}
function importData(inp){
  const f = inp.files && inp.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const d = JSON.parse(reader.result);
      if(!d || !Array.isArray(d.tasks)) throw new Error('格式不对');
      confirmDlg('导入数据', '导入会覆盖当前所有数据，确定继续吗？', ()=>{
        db = migrate(d); save(); renderAll(); toast('导入成功');
      });
    }catch(e){ toast('导入失败：文件格式不正确'); }
    inp.value = '';
  };
  reader.readAsText(f);
}
function clearAll(){
  confirmDlg('清空数据', '将删除所有任务、打卡记录、金币和奖品，且不可恢复。确定继续吗？', ()=>{
    db = { tasks:[], rewards:[], exchanges:[], records:{}, coins:0, settings: db.settings, created: Date.now() };
    save(); renderAll(); toast('已清空');
  });
}
function setDark(v){ db.settings.dark = v; save(); applyDark(); }
function applyDark(){
  const m = db.settings.dark;
  const sys = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = m==='dark' || (m==='auto' && sys);
  document.documentElement.classList.toggle('dark', dark);
}
function setBg(v){ db.settings.bg = v; save(); applyBg(); }
function applyBg(){
  const bg = document.getElementById('bg'); if(!bg) return;
  const mode = db.settings.bg || 'anim';
  bg.style.display = mode==='off' ? 'none' : 'block';
  bg.classList.toggle('static', mode==='static');
}

/* ================= 初始化 ================= */
function init(){
  document.querySelectorAll('#tabbar .tab').forEach(el=>{
    el.addEventListener('click', ()=>switchView(el.dataset.view));
  });
  if(window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyDark);
  applyDark();
  applyBg();
  setWall(true);
  renderAll();
}
init();
