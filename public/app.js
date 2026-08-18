const socket = io();
let state = null;
let selected = new Set();
const $ = id => document.getElementById(id);

function err(t){
  $('err').textContent = t;
  setTimeout(() => { if ($('err').textContent === t) $('err').textContent = ''; }, 2600);
}

$('create').onclick = () => socket.emit('createRoom', {name:$('name').value});
$('join').onclick = () => socket.emit('joinRoom', {code:$('code').value, name:$('name').value});
$('code').oninput = e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
$('code').onkeydown = e => { if(e.key === 'Enter') $('join').click(); };
$('name').onkeydown = e => { if(e.key === 'Enter') $('create').click(); };
$('start').onclick = () => socket.emit('startGame');
$('restart').onclick = () => {
  if(confirm('确定要立即重开本局吗？所有人的手牌和牌河都会重新洗牌。')) socket.emit('restartGame');
};
$('draw').onclick = () => socket.emit('draw');
$('skip').onclick = () => socket.emit('skipTurn');
$('discardBtn').onclick = () => {
  if(selected.size < 3) return err('每次至少选择3个字再出牌');
  socket.emit('discard', {indices:[...selected]});
};
$('voteYes').onclick = () => socket.emit('voteDiscard',{approve:true});
$('voteNo').onclick = () => socket.emit('voteDiscard',{approve:false});
$('win').onclick = () => socket.emit('declareWin',{sentence:$('sentence').value});
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
socket.on('log', t => feed('系统', t));
socket.on('chatMsg', m => feed(m.name, m.text));
function feed(name,text){
  const d=document.createElement('div');
  d.textContent=`${name}：${text}`;
  $('feed').appendChild(d);
  $('feed').scrollTop=$('feed').scrollHeight;
}

socket.on('state', s => {
  state=s;
  selected=new Set();
  render();
});

function render(){
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('roomCode').textContent=state.code;
  $('deckCount').textContent=state.deckCount;

  renderPlayers();
  renderSeats();

  const myId=socket.id;
  const me=state.players.find(p=>p.id===myId);
  const myTurn=state.started&&state.currentPlayerId===myId;
  const voting=!!state.pendingDiscard;

  $('start').classList.toggle('hidden',state.started||state.hostId!==myId);
  $('start').disabled=state.players.length<2;
  $('restart').classList.toggle('hidden',state.hostId!==myId || state.players.length<2);

  $('discard').innerHTML='';
  (state.discardGroups||[]).slice(-12).forEach(group=>{
    const wrap=document.createElement('div');
    wrap.className='discard-group';
    const label=document.createElement('span');
    label.className='discard-label';
    label.textContent=`${group.player}`;
    wrap.appendChild(label);
    group.tiles.forEach(ch=>wrap.appendChild(tile(ch,false)));
    $('discard').appendChild(wrap);
  });

  $('hand').innerHTML='';
  state.hand.forEach((ch,i)=>{
    const el=tile(ch,true);
    el.onclick=()=>{
      if(state.pendingDiscard || !myTurn || (!me?.hasDrawn && state.hand.length<14)) return;
      if(selected.has(i)) selected.delete(i); else selected.add(i);
      refreshSelection();
    };
    $('hand').appendChild(el);
  });

  renderVote();
  renderTurnPrompt(me,myTurn,voting);

  const canActAfterDraw = myTurn && (me?.hasDrawn || state.hand.length>=14);
  $('draw').disabled=voting||!myTurn||me?.hasDrawn||state.hand.length>=14;
  $('skip').disabled=voting||!canActAfterDraw;
  $('discardBtn').disabled=voting||!canActAfterDraw||selected.size<3;
  $('win').disabled=voting||!state.started||state.hand.length!==14;
  $('sentence').disabled=voting||!state.started||state.hand.length!==14;
  refreshSelection();

  if(state.lastWin){
    $('winner').textContent=`胡牌｜${state.lastWin.player}：${state.lastWin.sentence}`;
  } else {
    $('winner').textContent='';
  }
}

function renderPlayers(){
  $('players').innerHTML='';
  state.players.forEach(p=>{
    const d=document.createElement('div');
    d.className='player'+(p.id===state.currentPlayerId?' turn':'');
    const tags=[];
    if(p.id===state.hostId) tags.push('房主');
    if(p.id===state.currentPlayerId) tags.push('当前');
    d.textContent=`${p.name} · ${p.handCount}张${tags.length?' · '+tags.join(' / '):''}`;
    $('players').appendChild(d);
  });
}

function renderSeats(){
  const board=$('tableSeats');
  board.innerHTML='';
  if(!state.players.length) return;
  const myIndex=Math.max(0,state.players.findIndex(p=>p.id===socket.id));
  const ordered=[];
  for(let i=0;i<state.players.length;i++) ordered.push(state.players[(myIndex+i)%state.players.length]);

  // 从自己的正下方开始，按顺时针均匀排在桌边。
  const n=ordered.length;
  ordered.forEach((p,i)=>{
    const seat=document.createElement('div');
    seat.className='table-seat'+(p.id===socket.id?' me':'')+(p.id===state.currentPlayerId?' active':'');
    const angle=Math.PI/2 + (i/n)*Math.PI*2;
    const x=50 + Math.cos(angle)*43;
    const y=50 + Math.sin(angle)*40;
    seat.style.left=`${x}%`;
    seat.style.top=`${y}%`;
    const badges=[];
    if(p.id===state.hostId) badges.push('房主');
    if(p.id===state.currentPlayerId) badges.push('出牌');
    seat.innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${p.handCount}张${badges.length?' · '+badges.join(' / '):''}</span>`;
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
    if(state.pendingDiscard.playerId===socket.id) el.textContent='已出牌，请等待其他玩家投票';
    else el.textContent=`请判断「${state.pendingDiscard.tiles.join('')}」是否认可`;
    el.classList.add('attention');
    return;
  }
  if(myTurn){
    el.classList.add('my-turn');
    if(!me?.hasDrawn && state.hand.length<14) el.textContent='轮到你了：请先摸牌';
    else el.textContent='轮到你了：请选择要打的牌（至少3字），也可以跳过不出';
    return;
  }
  const current=state.players.find(p=>p.id===state.currentPlayerId);
  el.textContent=current?`等待 ${current.name} 操作…`:'等待下一位玩家…';
}

function renderVote(){
  const box=$('voteBox'), pd=state.pendingDiscard;
  if(!pd){box.classList.add('hidden'); return;}
  box.classList.remove('hidden');
  $('voteTitle').textContent=`${pd.playerName} 打出`;
  $('voteTiles').innerHTML='';
  pd.tiles.forEach(ch=>$('voteTiles').appendChild(tile(ch,false)));
  $('voteCount').textContent=`认可 ${pd.yes} · 不认可 ${pd.no} · 通过需要 ${pd.needed}/${pd.eligible}`;
  const isOwner=pd.playerId===socket.id;
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
  const me=state?.players.find(p=>p.id===socket.id);
  const myTurn=state?.started&&state.currentPlayerId===socket.id;
  const canAct=myTurn&&(me?.hasDrawn||state?.hand.length>=14);
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
