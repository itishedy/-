const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const TURN_MS = 45000;
const WIN_SCORE = 30;

function clearTurnTimer(room){
  if(room.turnTimer){ clearTimeout(room.turnTimer); room.turnTimer=null; }
}
function armTurnTimer(room){
  clearTurnTimer(room);
  const current=room.started ? room.players[room.turn] : null;
  // 倒计时只在当前玩家已经摸牌后开始；摸牌前无限等待。
  if(!room.started || room.pendingDiscard || !current || !current.hasDrawn){ room.turnDeadline=null; return; }
  room.turnDeadline=Date.now()+TURN_MS;
  const expectedKey=current.playerKey;
  room.turnTimer=setTimeout(()=>{
    if(!room.started || room.pendingDiscard) return;
    const p=room.players[room.turn];
    if(!p || p.playerKey!==expectedKey || !p.hasDrawn) return;
    p.hasDrawn=false;
    room.turnDeadline=null;
    addLog(room,`⏱️ ${p.name} 摸牌后45秒未完成出牌，自动跳过不出`);
    advanceTurn(room,p.playerKey);
    broadcast(room);
  },TURN_MS);
}

const TILE_COUNTS = {
  '我':3,'你':3,'他':2,'她':2,'的':4,'了':3,'是':2,'不':3,'在':2,'把':2,'被':2,'又':3,'还':2,'都':2,'就':1,'只':2,'才':2,'要':1,'给':2,'小':2,'大':2,'和':1,'跟':1,'敢':2,'竟':2,'真':2,'居':2,'然':2,'因':2,'为':2,'但':2,'别':1,'没':1,'吗':1,'啊':1,
  '老':3,'板':3,'店':2,'长':2,'前':2,'现':2,'任':2,'陪':3,'玩':3,'哥':2,'姐':2,'客':1,'人':1,'主':1,'播':1,'粉':1,'友':1,'鸡':2,'鸭':2,'宝':1,'贝':1,'富':1,'婆':1,
  '游':1,'戏':1,'局':2,'排':1,'位':1,'分':1,'段':1,'上':2,'下':1,'输':1,'赢':1,'开':1,'黑':2,'组':1,'队':1,'野':1,'王':1,'者':1,'号':1,'服':1,'区':1,'麦':2,'语':1,'音':1,'房':2,'间':1,'单':3,'双':1,'坑':2,'带':2,
  '接':2,'点':2,'报':2,'警':2,'包':1,'时':1,'钟':1,'钱':3,'付':1,'款':1,'退':2,'续':1,'加':2,'价':1,'免':1,'费':1,'礼':2,'物':2,'刷':2,'榜':1,
  '爱':2,'亲':2,'抱':2,'哄':2,'骗':2,'偷':2,'背':2,'绿':2,'追':2,'甩':1,'婚':1,'约':2,'睡':2,'查':1,'删':2,'拉':2,'黑':2,'吃':1,'醋':2,'哭':1,'舔':2,'跪':2,'跑':1,'找':1,'换':1,'选':1,'抢':1,
  '菜':3,'坑':3,'躺':2,'带':3,'飞':2,'骚':2,'送':2,'连':2,'跪':2,'炸':2,'猛':1,'强':1,'弱':1,'疯':2,'傻':1,'急':1,'惨':1,'穷':1,'帅':1,'丑':1,'甜':1,'凶':1,'冷':1,'热':1,'气':1,'酸':1,'爽':1,'麻':1,'挂':1,'夜':1,'掉':1
};

function buildDeck(){
  const deck=[];
  for(const [ch,n] of Object.entries(TILE_COUNTS)) for(let i=0;i<n;i++) deck.push(ch);
  for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s='';
  do { s=''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(s));
  return s;
}
function pendingVoteView(room, socketId){
  const pd=room.pendingDiscard;
  if(!pd) return null;
  const eligible=room.players.filter(p=>p.playerKey!==pd.playerKey && p.online).length;
  const votes=Object.values(pd.votes);
  const yes=votes.filter(Boolean).length;
  const no=votes.filter(v=>v===false).length;
  return {
    playerId:room.players.find(p=>p.playerKey===pd.playerKey)?.id || null,
    playerKey:pd.playerKey,
    playerName:pd.playerName,
    tiles:pd.tiles,
    yes,
    no,
    eligible,
    needed:Math.floor(eligible/2)+1,
    myVote:Object.prototype.hasOwnProperty.call(pd.votes,socketId) ? pd.votes[socketId] : null
  };
}
function roomView(room, socketId){
  const me=room.players.find(p=>p.id===socketId && p.online);
  return {
    code: room.code,
    hostId: room.players.find(p=>p.playerKey===room.hostPlayerKey && p.online)?.id || null,
    hostPlayerKey: room.hostPlayerKey,
    started: room.started,
    currentPlayerId: room.started ? (room.players[room.turn]?.id || null) : null,
    currentPlayerKey: room.started ? (room.players[room.turn]?.playerKey || null) : null,
    turnDeadline: room.turnDeadline || null,
    players: room.players.map(p=>({id:p.id,playerKey:p.playerKey,name:p.name,handCount:p.hand.length,hasDrawn:p.hasDrawn,score:p.score||0,totalScore:p.totalScore||0,online:!!p.online})),
    leaderboard: [...room.scoreboard.values()].sort((a,b)=>(b.totalScore||0)-(a.totalScore||0)).map(x=>({name:x.name,totalScore:x.totalScore||0,online:room.players.some(p=>p.playerKey===x.playerKey && p.online)})),
    hand: me ? me.hand : [],
    discardGroups: room.discardGroups,
    pendingDiscard: pendingVoteView(room,socketId),
    lastWin: room.lastWin,
    deckCount: room.deck.length
  };
}
function broadcast(room){ room.players.filter(p=>p.online&&p.id).forEach(p=>io.to(p.id).emit('state', roomView(room,p.id))); }
function addLog(room, text){ io.to(room.code).emit('log', text); }
function startRound(room, isRestart=false){
  room.deck=buildDeck();
  room.discardGroups=[];
  room.pendingDiscard=null;
  room.turn=0;
  room.started=true;
  room.lastWin=null;
  room.players.forEach(p=>{ p.hand=[]; p.hasDrawn=false; p.score=0; });
  for(let r=0;r<13;r++) for(const p of room.players) p.hand.push(room.deck.pop());
  addLog(room, isRestart ? '🔄 房主已重开本局，重新发牌并清零本局积分；累计积分保留。' : '游戏开始！每人13张；轮到自己先摸牌，摸牌后开始45秒倒计时。累计达到30分判定获胜。');
  clearTurnTimer(room); room.turnDeadline=null;
  broadcast(room);
}
function advanceTurn(room, playerKey){
  const idx=room.players.findIndex(x=>x.playerKey===playerKey);
  room.turn=room.players.length ? (idx+1)%room.players.length : 0;
}


function scoreVictory(room,p){
  if((p.totalScore||0) < WIN_SCORE) return false;
  room.lastWin={player:p.name,score:p.score,totalScore:p.totalScore,reason:'累计达到30分'};
  room.started=false;
  clearTurnTimer(room); room.turnDeadline=null;
  addLog(room,`🏆 ${p.name} 累计达到 ${p.totalScore} 分，率先达到30分，获得本场胜利！`);
  return true;
}

function resolvePendingDiscard(room, approved){
  const pd=room.pendingDiscard;
  if(!pd) return;
  const p=room.players.find(x=>x.playerKey===pd.playerKey);
  room.pendingDiscard=null;

  if(!p){ broadcast(room); return; }

  if(approved){
    room.discardGroups.push({player:p.name,tiles:pd.tiles});
    p.score=(p.score||0)+pd.tiles.length;
    p.totalScore=(p.totalScore||0)+pd.tiles.length;
    const scoreEntry=room.scoreboard.get(p.playerKey);
    if(scoreEntry){ scoreEntry.name=p.name; scoreEntry.totalScore=p.totalScore; }
    p.hasDrawn=false;
    if(p.hand.length===0){
      p.score+=10;
      p.totalScore=(p.totalScore||0)+10;
      const scoreEntry2=room.scoreboard.get(p.playerKey);
      if(scoreEntry2){ scoreEntry2.name=p.name; scoreEntry2.totalScore=p.totalScore; }
      // 先检查30分总胜利；未到30分则按原规则结束本小局。
      if(!scoreVictory(room,p)){
        room.lastWin={player:p.name,score:p.score,totalScore:p.totalScore,reason:'打光手牌'};
        room.started=false;
        clearTurnTimer(room); room.turnDeadline=null;
        addLog(room,`🏆 ${p.name} 打光了全部手牌，本局获胜！清手奖励 +10 分，本局共 ${p.score} 分，房间累计 ${p.totalScore} 分。`);
      }
    }else if(!scoreVictory(room,p)){
      addLog(room,`✅ 「${pd.tiles.join('')}」获得过半认可，${p.name} 出牌成功，+${pd.tiles.length}分，累计${p.totalScore}分，剩余${p.hand.length}张`);
      advanceTurn(room,p.playerKey);
      clearTurnTimer(room); room.turnDeadline=null;
    }
  }else{
    p.hand.push(...pd.tiles);
    p.hasDrawn=true;
    addLog(room,`❌ 「${pd.tiles.join('')}」未获过半认可，牌已退回 ${p.name}，请重新出牌或选择跳过（重新计45秒）`);
    armTurnTimer(room);
  }
  broadcast(room);
}

function checkPendingVote(room){
  const pd=room.pendingDiscard;
  if(!pd) return;
  const eligibleIds=room.players.filter(p=>p.playerKey!==pd.playerKey && p.online && p.id).map(p=>p.id);
  for(const id of Object.keys(pd.votes)) if(!eligibleIds.includes(id)) delete pd.votes[id];
  const eligible=eligibleIds.length;
  if(eligible===0){ resolvePendingDiscard(room,true); return; }
  const needed=Math.floor(eligible/2)+1;
  const votes=Object.values(pd.votes);
  const yes=votes.filter(Boolean).length;
  const no=votes.filter(v=>v===false).length;
  if(yes>=needed) return resolvePendingDiscard(room,true);
  const remaining=eligible-yes-no;
  if(yes+remaining<needed) return resolvePendingDiscard(room,false);
  broadcast(room);
}

io.on('connection', socket=>{
  socket.on('createRoom', ({name,playerKey})=>{
    name=String(name||'玩家').trim().slice(0,16)||'玩家';
    playerKey=String(playerKey||socket.id).slice(0,80);
    const code=roomCode();
    const scoreboard=new Map([[playerKey,{playerKey,name,totalScore:0}]]);
    const room={code,hostPlayerKey:playerKey,players:[{id:socket.id,playerKey,name,hand:[],hasDrawn:false,score:0,totalScore:0,online:true}],scoreboard,deck:[],discardGroups:[],pendingDiscard:null,turn:0,started:false,lastWin:null,turnDeadline:null,turnTimer:null};
    rooms.set(code,room); socket.join(code); socket.data.room=code;
    broadcast(room);
  });
  socket.on('joinRoom', ({code,name,playerKey})=>{
    code=String(code||'').trim().toUpperCase(); name=String(name||'玩家').trim().slice(0,16)||'玩家'; playerKey=String(playerKey||socket.id).slice(0,80);
    const room=rooms.get(code); if(!room) return socket.emit('errorMsg','房间不存在');

    // 已在房间中的玩家可在对局进行中重连：优先认浏览器 playerKey；其次允许同名的离线席位认领。
    let existing=room.players.find(p=>p.playerKey===playerKey);
    if(!existing) existing=room.players.find(p=>!p.online && p.name===name);
    if(existing){
      if(existing.online && existing.id!==socket.id) return socket.emit('errorMsg','这个玩家已经在线');
      const oldId=existing.id;
      const oldKey=existing.playerKey;
      const saved=room.scoreboard.get(oldKey) || room.scoreboard.get(playerKey);
      if(oldKey!==playerKey && saved){ room.scoreboard.delete(oldKey); saved.playerKey=playerKey; room.scoreboard.set(playerKey,saved); }
      existing.id=socket.id; existing.online=true; existing.name=name; existing.playerKey=playerKey;
      if(saved){ saved.name=name; existing.totalScore=saved.totalScore||existing.totalScore||0; }
      socket.join(code); socket.data.room=code;
      if(room.hostPlayerKey===oldKey) room.hostPlayerKey=playerKey;
      if(room.pendingDiscard){
        if(room.pendingDiscard.playerKey===oldKey){ room.pendingDiscard.playerKey=playerKey; room.pendingDiscard.playerId=socket.id; }
        if(oldId && Object.prototype.hasOwnProperty.call(room.pendingDiscard.votes,oldId)){ room.pendingDiscard.votes[socket.id]=room.pendingDiscard.votes[oldId]; delete room.pendingDiscard.votes[oldId]; }
      }
      addLog(room,`${name} 已重新连接对局`);
      checkPendingVote(room); broadcast(room); return;
    }

    if(room.started) return socket.emit('errorMsg','对局已开始；只有原局内玩家可以重新加入');
    if(room.players.length>=8) return socket.emit('errorMsg','房间已满（最多8人）');
    const saved=room.scoreboard.get(playerKey);
    if(saved) saved.name=name; else room.scoreboard.set(playerKey,{playerKey,name,totalScore:0});
    room.players.push({id:socket.id,playerKey,name,hand:[],hasDrawn:false,score:0,totalScore:saved?.totalScore||0,online:true}); socket.join(code); socket.data.room=code;
    addLog(room, `${name} 加入了房间`); broadcast(room);
  });
  socket.on('startGame', ()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    if(room.hostPlayerKey!==room.players.find(p=>p.id===socket.id)?.playerKey) return socket.emit('errorMsg','只有房主可以开始');
    if(room.players.length<2) return socket.emit('errorMsg','至少需要2名玩家');
    startRound(room,false);
  });
  socket.on('restartGame', ()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    if(room.hostPlayerKey!==room.players.find(p=>p.id===socket.id)?.playerKey) return socket.emit('errorMsg','只有房主可以重开');
    if(room.players.length<2) return socket.emit('errorMsg','至少需要2名玩家');
    startRound(room,true);
  });
  socket.on('endGame', ()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    if(room.hostPlayerKey!==room.players.find(p=>p.id===socket.id)?.playerKey) return socket.emit('errorMsg','只有房主可以结束对局');

    clearTurnTimer(room); room.turnDeadline=null;
    const leaderboard=[...room.scoreboard.values()]
      .sort((a,b)=>(b.totalScore||0)-(a.totalScore||0))
      .map((x,i)=>({rank:i+1,name:x.name,totalScore:x.totalScore||0}));
    const host=room.players.find(p=>p.id===socket.id);
    io.to(room.code).emit('roomEnded',{endedBy:host?.name||'房主',leaderboard});

    // “结束对局”会结算并关闭房间；所有客户端回到大厅，原房间码立即失效。
    for(const player of room.players){
      const client=io.sockets.sockets.get(player.id);
      if(client){
        client.leave(room.code);
        client.data.room=null;
      }
    }
    rooms.delete(room.code);
  });
  socket.on('draw', ()=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','正在等待大家投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(p.hasDrawn) return socket.emit('errorMsg','本回合已经摸过牌了，请出牌或跳过');
    if(!room.deck.length){ p.hasDrawn=true; addLog(room,`牌堆已空，${p.name} 本轮无需摸牌，45秒倒计时开始`); armTurnTimer(room); return broadcast(room); }
    p.hand.push(room.deck.pop()); p.hasDrawn=true; addLog(room,`${p.name} 摸了一张牌，45秒倒计时开始`); armTurnTimer(room); broadcast(room);
  });
  socket.on('skipTurn', ()=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','正在等待大家投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(!p.hasDrawn) return socket.emit('errorMsg','请先摸牌再跳过');
    p.hasDrawn=false;
    addLog(room,`⏭️ ${p.name} 选择跳过，本轮不出牌`);
    advanceTurn(room,p.playerKey);
    clearTurnTimer(room); room.turnDeadline=null;
    broadcast(room);
  });
  socket.on('discard', ({indices})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','上一组出牌还在等待投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(!p.hasDrawn) return socket.emit('errorMsg','请先摸牌');

    if(!Array.isArray(indices)) return socket.emit('errorMsg','请选择至少2张牌');
    const clean=[];
    const seen=new Set();
    for(const raw of indices){
      const i=Number(raw);
      if(!Number.isInteger(i)||i<0||i>=p.hand.length) return socket.emit('errorMsg','选中的牌无效');
      if(seen.has(i)) continue;
      seen.add(i);
      clean.push(i);
    }
    if(clean.length<2) return socket.emit('errorMsg','每次出牌至少需要2个字');

    // 保留玩家点击牌面的先后顺序，用这个顺序展示出牌。
    const tiles=clean.map(i=>p.hand[i]);
    for(const i of [...clean].sort((a,b)=>b-a)) p.hand.splice(i,1);
    clearTurnTimer(room); room.turnDeadline=null;
    room.pendingDiscard={playerId:p.id,playerKey:p.playerKey,playerName:p.name,tiles,votes:{}};
    addLog(room,`🗳️ ${p.name} 提交「${tiles.join('')}」，等待其他玩家认可`);
    checkPendingVote(room);
  });
  socket.on('voteDiscard', ({approve})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started||!room.pendingDiscard) return;
    const pd=room.pendingDiscard;
    if(room.players.find(p=>p.id===socket.id)?.playerKey===pd.playerKey) return socket.emit('errorMsg','不能给自己的出牌投票');
    if(!room.players.some(p=>p.id===socket.id)) return;
    if(Object.prototype.hasOwnProperty.call(pd.votes,socket.id)) return socket.emit('errorMsg','你已经投过票了');
    pd.votes[socket.id]=approve===true;
    const voter=room.players.find(p=>p.id===socket.id);
    addLog(room,`${voter?.name||'玩家'} 已投票`);
    checkPendingVote(room);
  });
  socket.on('declareWin', ()=>{
    socket.emit('errorMsg','新版规则无需手动胡牌：最先打光手牌的人自动获胜');
  });
  socket.on('quickPhrase', ({text})=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id && x.online); if(!p) return;
    const allowed=['我等的花儿都谢了','请喝卡布奇诺','牛逼','垃圾'];
    text=String(text||'');
    if(!allowed.includes(text)) return;
    const now=Date.now();
    if(p.lastQuickAt && now-p.lastQuickAt<500) return;
    p.lastQuickAt=now;

    // 同一句快捷互动在 3 秒内连续触发时，形成全房间连击。
    if(room.quickCombo && room.quickCombo.text===text && now-room.quickCombo.at<=3000){
      room.quickCombo.count+=1;
      room.quickCombo.at=now;
    } else {
      room.quickCombo={text,count:1,at:now};
    }
    io.to(room.code).emit('quickPhrase',{name:p.name,text,combo:room.quickCombo.count});
  });
  socket.on('chat', ({text})=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id); text=String(text||'').trim().slice(0,120);
    if(p&&text) io.to(room.code).emit('chatMsg',{name:p.name,text});
  });
  socket.on('disconnect', ()=>{
    const code=socket.data.room, room=rooms.get(code); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id); if(!p) return;
    p.online=false; p.id=null;
    if(room.pendingDiscard){
      delete room.pendingDiscard.votes[socket.id];
      checkPendingVote(room);
    }
    // 对局进行中保留席位、手牌和积分，允许玩家之后凭房间号重新进入。
    // 未开局房间如果所有人都离线，则直接销毁，避免空房间常驻。
    if(!room.started && !room.players.some(x=>x.online)){
      clearTurnTimer(room); rooms.delete(code); return;
    }
    addLog(room,`${p.name} 暂时离线，可用原昵称和房间号重新加入`);
    broadcast(room);
  });

});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Listening on http://localhost:${PORT}`));
