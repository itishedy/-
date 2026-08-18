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
$('draw').onclick = () => socket.emit('draw');
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

  $('players').innerHTML='';
  state.players.forEach(p=>{
    const d=document.createElement('div');
    d.className='player'+(p.id===state.currentPlayerId?' turn':'');
    const tags=[];
    if(p.id===state.hostId) tags.push('庄');
    if(p.id===state.currentPlayerId) tags.push('当前');
    d.textContent=`${p.name} · ${p.handCount}张${tags.length?' · '+tags.join(' / '):''}`;
    $('players').appendChild(d);
  });

  const myId=socket.id;
  $('start').classList.toggle('hidden',state.started||state.hostId!==myId);
  $('start').disabled=state.players.length<2;

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
      if(state.pendingDiscard) return;
      if(selected.has(i)) selected.delete(i); else selected.add(i);
      refreshSelection();
    };
    $('hand').appendChild(el);
  });

  renderVote();
  const me=state.players.find(p=>p.id===myId);
  const myTurn=state.started&&state.currentPlayerId===myId;
  const voting=!!state.pendingDiscard;
  $('draw').disabled=voting||!myTurn||me?.hasDrawn;
  $('discardBtn').disabled=voting||!myTurn||!me?.hasDrawn||selected.size<3;
  $('win').disabled=voting||!state.started||state.hand.length!==14;
  $('sentence').disabled=voting||!state.started||state.hand.length!==14;
  refreshSelection();

  if(state.lastWin){
    $('winner').textContent=`胡牌｜${state.lastWin.player}：${state.lastWin.sentence}`;
  } else {
    $('winner').textContent='';
  }
}

function renderVote(){
  const box=$('voteBox'), pd=state.pendingDiscard;
  if(!pd){box.classList.add('hidden'); return;}
  box.classList.remove('hidden');
  $('voteTitle').textContent=`${pd.playerName} 打出`;
  $('voteTiles').innerHTML='';
  pd.tiles.forEach(ch=>$('voteTiles').appendChild(tile(ch,false)));
  $('voteCount').textContent=`认可 ${pd.yes} · 不认可 ${pd.no} · 过牌需要 ${pd.needed}/${pd.eligible}`;
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
  [...$('hand').children].forEach((el,i)=>el.classList.toggle('sel',selected.has(i)));
  const n=selected.size;
  $('discardBtn').textContent=n ? `出牌（已选${n}字）` : '出牌（至少3字）';
  $('selectionHint').textContent=n ? `已选 ${n} 张` : '点击牌面选择';
  const me=state?.players.find(p=>p.id===socket.id);
  const myTurn=state?.started&&state.currentPlayerId===socket.id;
  $('discardBtn').disabled=!!state?.pendingDiscard||!myTurn||!me?.hasDrawn||n<3;
}

function tile(ch){
  const d=document.createElement('div');
  d.className='tile';
  d.textContent=ch;
  return d;
}
