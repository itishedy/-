const socket = io();
const playerKey = localStorage.getItem('bssm-player-key') || (()=>{ const v=(crypto.randomUUID?.() || Math.random().toString(36).slice(2)+Date.now().toString(36)); localStorage.setItem('bssm-player-key',v); return v; })();
let state = null;
let selected = new Set();
const $ = id => document.getElementById(id);
let endReturnTimer=null;
const savedName=localStorage.getItem('bssm-player-name')||'';
const savedRoom=localStorage.getItem('bssm-last-room')||'';
window.addEventListener('DOMContentLoaded',()=>{ if($('name')) $('name').value=savedName; if($('code')) $('code').value=savedRoom; });

// Socket.IO 网络恢复后，如果页面仍在局内，自动认领自己的原席位。
socket.on('connect',()=>{
  if(state?.code){ socket.emit('joinRoom',{code:state.code,name:localStorage.getItem('bssm-player-name')||$('name')?.value||'玩家',playerKey}); }
});

function err(t){
  $('err').textContent = t;
  setTimeout(() => { if ($('err').textContent === t) $('err').textContent = ''; }, 2600);
}

$('create').onclick = () => { localStorage.setItem('bssm-player-name',$('name').value.trim()); socket.emit('createRoom', {name:$('name').value,playerKey}); };
$('join').onclick = () => { localStorage.setItem('bssm-player-name',$('name').value.trim()); localStorage.setItem('bssm-last-room',$('code').value.trim().toUpperCase()); socket.emit('joinRoom', {code:$('code').value, name:$('name').value,playerKey}); };
$('code').oninput = e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
$('code').onkeydown = e => { if(e.key === 'Enter') $('join').click(); };
$('name').onkeydown = e => { if(e.key === 'Enter') $('create').click(); };
$('start').onclick = () => socket.emit('startGame');
$('restart').onclick = () => {
  if(confirm('确定要重开本局吗？所有人重新抓牌，本局积分清零，但房间累计积分保留。')) socket.emit('restartGame');
};
$('endGame').onclick = () => {
  if(confirm('确定结束对局并关闭房间吗？将按当前累计积分结算，房间码随后失效。')) socket.emit('endGame');
};
$('draw').onclick = () => socket.emit('draw');
$('skip').onclick = () => socket.emit('skipTurn');
$('discardBtn').onclick = () => {
  if(selected.size < 3) return err('每次至少选择3个字再出牌');
  socket.emit('discard', {indices:[...selected]});
};
$('voteYes').onclick = () => socket.emit('voteDiscard',{approve:true});
$('voteNo').onclick = () => socket.emit('voteDiscard',{approve:false});
document.querySelectorAll('.quick-phrase').forEach(btn=>{ btn.onclick=()=>socket.emit('quickPhrase',{text:btn.dataset.phrase}); });
$('send').onclick = sendChat;
$('chat').onkeydown = e => { if(e.key === 'Enter') sendChat(); };

function sendChat(){
  const text = $('chat').value.trim();
  if(text){ socket.emit('chat',{text}); $('chat').value=''; }
}

$('copy').onclick = async () => {
  try{
    await navigator.clipboard?.writeText(state?.code || '');
    const old = $('copy').textContent;
    $('copy').textContent = '已复制';
    setTimeout(() => $('copy').textContent = old, 1000);
  }catch(_){ err('复制失败，请手动复制房间码'); }
};

socket.on('errorMsg', err);
socket.on('log', t => feed('system','系统', t));
socket.on('chatMsg', m => feed('user',m.name, m.text));
socket.on('quickPhrase', m => { feed('quick',m.name,m.text); showQuickPhrase(m); });
function feed(type,name,text){
  const d=document.createElement('div');
  d.className=`feed-item ${type}`;
  const who=document.createElement('span');
  who.className='feed-name';
  who.textContent=name;
  const body=document.createElement('span');
  body.className='feed-text';
  body.textContent=text;
  d.append(who,body);
  $('feed').appendChild(d);
  $('feed').scrollTop=$('feed').scrollHeight;
}

let quickToastTimer=null;
function showQuickPhrase(m){
  const box=$('quickToast');
  if(box){
    box.textContent=`${m.name}：${m.text}`;
    box.classList.remove('hidden');
    clearTimeout(quickToastTimer);
    quickToastTimer=setTimeout(()=>box.classList.add('hidden'),2200);
  }
  // 用系统语音尽量还原斗地主式快捷语音；若浏览器限制自动语音，视觉提示仍正常显示。
  try{
    if('speechSynthesis' in window){
      const u=new SpeechSynthesisUtterance(m.text);
      u.lang='zh-CN'; u.rate=1.05; u.pitch=1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  }catch(_){ }
}

socket.on('roomEnded', result => {
  showFinalLeaderboard(result);
});

function showFinalLeaderboard(result){
  const box=$('finalLeaderboard');
  box.innerHTML='';
  (result?.leaderboard||[]).forEach(x=>{
    const row=document.createElement('div');
    row.className='final-rank-row';
    row.innerHTML=`<span>${x.rank}</span><strong>${escapeHtml(x.name)}</strong><b>${x.totalScore}分</b>`;
    box.appendChild(row);
  });
  $('finalEndedBy').textContent=`房主 ${result?.endedBy||'房主'} 已结束对局`;
  $('finalOverlay').classList.remove('hidden');
  let left=5;
  const update=()=>{ $('finalReturn').textContent=`返回大厅（${left}）`; };
  update();
  clearInterval(endReturnTimer);
  endReturnTimer=setInterval(()=>{ left--; update(); if(left<=0) returnToLobby(); },1000);
}

function returnToLobby(){
  clearInterval(endReturnTimer); endReturnTimer=null;
  state=null; selected=new Set();
  localStorage.removeItem('bssm-last-room');
  $('finalOverlay').classList.add('hidden');
  $('game').classList.add('hidden'); $('lobby').classList.remove('hidden');
  $('feed').innerHTML=''; $('winner').textContent=''; $('code').value='';
}

$('finalReturn').onclick=returnToLobby;


socket.on('state', s => {
  state=s;
  localStorage.setItem('bssm-last-room',s.code||'');
  const mine=s.players?.find(p=>p.playerKey===playerKey); if(mine) localStorage.setItem('bssm-player-name',mine.name);
  selected=new Set();
  render();
});

function render(){
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('roomCode').textContent=state.code;
  $('deckCount').textContent=state.deckCount;

  renderPlayers();
  renderLeaderboard();
  renderSeats();

  const myId=socket.id;
  const me=state.players.find(p=>p.playerKey===playerKey);
  const myTurn=state.started&&state.currentPlayerKey===playerKey;
  const voting=!!state.pendingDiscard;

  $('start').classList.toggle('hidden',state.started||state.hostPlayerKey!==playerKey);
  $('start').disabled=state.players.length<2;
  $('restart').classList.toggle('hidden',state.hostPlayerKey!==playerKey || state.players.length<2);
  $('endGame').classList.toggle('hidden',state.hostPlayerKey!==playerKey);

  $('discard').innerHTML='';
  (state.discardGroups||[]).forEach(group=>{
    const wrap=document.createElement('div');
    wrap.className='discard-group';
    const label=document.createElement('span');
    label.className='discard-label';
    label.textContent=`${group.player}`;
    wrap.appendChild(label);
    group.tiles.forEach(ch=>wrap.appendChild(tile(ch,false)));
    $('discard').appendChild(wrap);
  });
  $('discardZone').scrollTop=$('discardZone').scrollHeight;

  $('hand').innerHTML='';
  $('hand').classList.toggle('crowded',state.hand.length>=15);
  $('hand').classList.toggle('very-crowded',state.hand.length>=21);
  state.hand.forEach((ch,i)=>{
    const el=tile(ch,true);
    el.onclick=()=>{
      if(state.pendingDiscard || !myTurn || !me?.hasDrawn) return;
      if(selected.has(i)) selected.delete(i); else selected.add(i);
      refreshSelection();
    };
    $('hand').appendChild(el);
  });

  renderVote();
  renderTurnPrompt(me,myTurn,voting);

  const canActAfterDraw = myTurn && !!me?.hasDrawn;
  $('draw').disabled=voting||!myTurn||!!me?.hasDrawn;
  $('skip').disabled=voting||!canActAfterDraw;
  $('discardBtn').disabled=voting||!canActAfterDraw||selected.size<3;
  refreshSelection();

  if(state.lastWin){
    $('winner').textContent=`获胜｜${state.lastWin.player} · ${state.lastWin.reason||'本局胜利'} · 本局${state.lastWin.score}分 · 累计${state.lastWin.totalScore||0}分`;
  } else {
    $('winner').textContent='';
  }
}

function renderPlayers(){
  $('players').innerHTML='';
  state.players.forEach(p=>{
    const d=document.createElement('div');
    d.className='player'+(p.playerKey===state.currentPlayerKey?' turn':'')+(p.online?'':' offline');
    const tags=[];
    if(p.playerKey===state.hostPlayerKey) tags.push('房主');
    if(p.playerKey===state.currentPlayerKey) tags.push('当前');
    if(!p.online) tags.push('离线');
    d.textContent=`${p.name} · ${p.handCount}张 · 本局${p.score||0} · 累计${p.totalScore||0}${tags.length?' · '+tags.join(' / '):''}`;
    $('players').appendChild(d);
  });
}

function renderLeaderboard(){
  const box=$('leaderboard');
  if(!box) return;
  box.innerHTML='';
  (state.leaderboard||[]).forEach((p,i)=>{
    const row=document.createElement('div');
    row.className='leaderboard-row'+(p.online?' online':' offline');
    const rank=document.createElement('span');
    rank.className='leaderboard-rank';
    rank.textContent=String(i+1);
    const name=document.createElement('span');
    name.className='leaderboard-name';
    name.textContent=p.name;
    const score=document.createElement('strong');
    score.className='leaderboard-score';
    score.textContent=String(p.totalScore||0);
    row.append(rank,name,score);
    box.appendChild(row);
  });
}

function renderSeats(){
  const board=$('tableSeats');
  board.innerHTML='';
  if(!state.players.length) return;
  const myIndex=Math.max(0,state.players.findIndex(p=>p.playerKey===playerKey));
  const ordered=[];
  for(let i=0;i<state.players.length;i++) ordered.push(state.players[(myIndex+i)%state.players.length]);

  // 从自己的正下方开始，按顺时针均匀排在桌边。
  const n=ordered.length;
  const selfBox=$('selfSeat');
  if(selfBox) selfBox.innerHTML='';

  ordered.forEach((p,i)=>{
    const badges=[];
    if(p.playerKey===state.hostPlayerKey) badges.push('房主');
    if(p.playerKey===state.currentPlayerKey) badges.push('出牌');
    if(!p.online) badges.push('离线');
    const meta=`${p.handCount}张 · 本局${p.score||0} · 累计${p.totalScore||0}${badges.length?' · '+badges.join(' / '):''}`;

    // 自己的名牌单独放到手牌区上方，彻底脱离牌桌浮层，避免遮挡手牌。
    if(p.playerKey===playerKey){
      if(selfBox){
        selfBox.className='self-seat-badge'+(p.playerKey===state.currentPlayerKey?' active':'');
        selfBox.innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${meta}</span>`;
      }
      return;
    }

    const seat=document.createElement('div');
    seat.className='table-seat'+(p.playerKey===state.currentPlayerKey?' active':'')+(p.online?'':' offline');
    const angle=Math.PI/2 + (i/n)*Math.PI*2;
    const x=50 + Math.cos(angle)*43;
    const y=50 + Math.sin(angle)*40;
    seat.style.left=`${x}%`;
    seat.style.top=`${y}%`;
    seat.innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${meta}</span>`;
    board.appendChild(seat);
  });
}

function renderTurnPrompt(me,myTurn,voting){
  const el=$('turnPrompt');
  el.className='turn-prompt';
  if(state.lastWin){
    el.textContent='本局已结束，房主可以随时重开';
    return;
  }
  if(!state.started){
    el.textContent=state.hostId===socket.id?'等待牌友到齐，可以开局':'等待房主开局';
    return;
  }
  if(voting){
    if(state.pendingDiscard.playerKey===playerKey) el.textContent='已出牌，请等待其他玩家投票';
    else el.textContent=`请判断「${state.pendingDiscard.tiles.join('')}」是否认可`;
    el.classList.add('attention');
    return;
  }
  const hasTimer=!!state.turnDeadline;
  const sec=hasTimer?Math.max(0,Math.ceil((state.turnDeadline-Date.now())/1000)):null;
  if(myTurn){
    el.classList.add('my-turn');
    if(!me?.hasDrawn) el.textContent='轮到你了：请先摸牌（摸牌后开始45秒）';
    else el.textContent=`已摸牌：请选择要打的牌（至少3字），也可以跳过不出 · ${sec ?? 45}s`;
    return;
  }
  const current=state.players.find(p=>p.playerKey===state.currentPlayerKey);
  const suffix=hasTimer?` · ${sec}s`:' · 等待摸牌';
  el.textContent=current?`等待 ${current.name} 操作${suffix}`:'等待下一位玩家…';
}

function renderVote(){
  const box=$('voteBox'), pd=state.pendingDiscard;
  if(!pd){box.classList.add('hidden'); return;}
  box.classList.remove('hidden');
  $('voteTitle').textContent=`${pd.playerName} 打出`;
  $('voteTiles').innerHTML='';
  pd.tiles.forEach(ch=>$('voteTiles').appendChild(tile(ch,false)));
  $('voteCount').textContent=`认可 ${pd.yes} · 不认可 ${pd.no} · 通过需要 ${pd.needed}/${pd.eligible}`;
  const isOwner=pd.playerKey===playerKey;
  const voted=pd.myVote!==null;
  $('voteYes').classList.toggle('hidden',isOwner);
  $('voteNo').classList.toggle('hidden',isOwner);
  $('voteYes').disabled=voted;
  $('voteNo').disabled=voted;
  if(isOwner) $('voteStatus').textContent='等其他牌友表态…';
  else if(voted) $('voteStatus').textContent=pd.myVote?'你已认可':'你已不认可';
  else $('voteStatus').textContent='这组字成立吗？';
}

function refreshSelection(){
  const ordered=[...selected];
  [...$('hand').children].forEach((el,i)=>{
    const order=ordered.indexOf(i);
    el.classList.toggle('sel',order>=0);
    if(order>=0) el.dataset.order=String(order+1); else delete el.dataset.order;
  });
  const n=ordered.length;
  const phrase=state ? ordered.map(i=>state.hand[i]).join('') : '';
  $('discardBtn').textContent=n ? `打出「${phrase}」` : '出牌（至少3字）';
  $('selectionHint').textContent=n ? `语序：${phrase} · ${n}张` : '按想要的语序依次点牌';
  const me=state?.players.find(p=>p.playerKey===playerKey);
  const myTurn=state?.started&&state.currentPlayerKey===playerKey;
  const canAct=myTurn&&!!me?.hasDrawn;
  $('discardBtn').disabled=!!state?.pendingDiscard||!canAct||n<3;
}

function tile(ch){
  const d=document.createElement('div');
  d.className='tile';
  d.textContent=ch;
  return d;
}
function escapeHtml(text){
  return String(text).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

setInterval(()=>{
  if(!state?.started || state.pendingDiscard) return;
  const me=state.players.find(p=>p.playerKey===playerKey);
  renderTurnPrompt(me,state.currentPlayerKey===playerKey,false);
},250);
