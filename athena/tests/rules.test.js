const test = require('node:test');
const assert = require('node:assert/strict');
const { Model, Rules, Effects } = require('./load.js');

const map = text => Model.parse('dae: 1\n' + text);
/** Replays steps; fails the test on an illegal step unless `bad` is the expected error text. */
const play = (m, steps, bad) => {
  const r = Rules.replay(m, steps);
  if(bad) assert.match(r.error ?? '', bad);
  else assert.equal(r.error, undefined, `step ${r.at}: ${r.error}`);
  return r;
};
const acts = (m, s) => Rules.actions(m, s).map(Rules.actionStr);
const stats = (m, s) => Effects.player(Rules.ctx(m), s);
const lines = r => r.log.flatMap(l => l.log);

const ROOMS2 = 'rooms[2]{id,flags,items,enemies}:\n  r0,entry,ITEMS,\n  r1,exit,,FOES\npassages[1]{id,a,b}:\n  p0,r0,r1\n';
const two = (items = '', foes = '', extra = '') => map(extra + ROOMS2.replace('ITEMS', items).replace('FOES', foes));

//#region [ Start, moving ]
test('start: entry room, full hp, start items in the bag', () => {
  const m = map('player:\n  hp: 12\n  start[1]: a\nitems[1]{id}:\n  a\nrooms[1]{id,flags}:\n  r0,entry+exit\n');
  const s = Rules.init(m);
  assert.equal(s.room, 'r0');
  assert.equal(s.hp, 12);
  assert.deepEqual(s.bag.map(e => e.id), ['a']);
  assert.equal(s.won, true);
});

test('move: reaching the exit wins', () => {
  const r = play(two(), ['move r1']);
  assert.equal(r.state.won, true);
  assert.equal(r.state.visits.r1, 1);
});

test('move: one-way passage only goes a>b', () => {
  const m = map('rooms[2]{id,flags}:\n  r0,entry\n  r1,exit\npassages[1]{id,a,b,dir}:\n  p0,r1,r0,a>b\n');
  play(m, ['move r1'], /no open way/);
});

test('move: required rooms must be visited before the exit counts', () => {
  const m = map('rooms[3]{id,flags,mark}:\n  r0,entry,\n  r1,exit,\n  r2,,required\npassages[2]{id,a,b}:\n  p0,r0,r1\n  p1,r0,r2\n');
  assert.equal(play(m, ['move r1']).state.won, false);
  assert.equal(play(m, ['move r2', 'move r0', 'move r1']).state.won, true);
});
//#endregion

//#region [ Keys and locks ]
const KEYMAP = (uses = '1') => map(`items[1]{id,key,keyUses}:
  k,red,${uses}
rooms[3]{id,flags,items}:
  r0,entry,k
  r1,,
  r2,exit,
passages[2]{id,a,b,lock}:
  p0,r0,r1,key:red
  p1,r1,r2,key:red
`);

test('key: locked passage needs the key', () => {
  play(KEYMAP(), ['move r1'], /no open way/);
});

test('key: one use opens one lock and is used up', () => {
  const r = play(KEYMAP(), ['take k', 'move r1']);
  assert.deepEqual(r.state.bag, []);
  assert.ok(lines(r).includes('k used up'));
  play(KEYMAP(), ['take k', 'move r1', 'move r2'], /no open way/);
});

test('key: an opened lock stays open', () => {
  const r = play(KEYMAP(), ['take k', 'move r1', 'move r0', 'move r1']);
  assert.equal(r.state.room, 'r1');
});

test('key: inf uses opens every lock', () => {
  const r = play(KEYMAP('inf'), ['take k', 'move r1', 'move r2']);
  assert.equal(r.state.won, true);
  assert.equal(r.state.bag[0].k, null);
});

test('key: 2 uses', () => {
  const r = play(KEYMAP('2'), ['take k', 'move r1', 'move r2']);
  assert.equal(r.state.won, true);
});

test('lock: item condition does not consume the item', () => {
  const m = map('items[1]{id}:\n  badge\nrooms[2]{id,flags,items}:\n  r0,entry,badge\n  r1,exit,\npassages[1]{id,a,b,lock}:\n  p0,r0,r1,item:badge\n');
  const r = play(m, ['take badge', 'move r1']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['badge']);
});

test('lock: stat condition counts equipped bonuses', () => {
  const m = map(`player:
  str: 3
  slots[1]{id}:
    hand
items[1]{id,slot,str}:
  bar,hand,2
rooms[2]{id,flags,items}:
  r0,entry,bar
  r1,exit,
passages[1]{id,a,b,lock}:
  p0,r0,r1,stat:str=5
`);
  play(m, ['take bar', 'move r1'], /no open way/);
  assert.equal(play(m, ['take bar', 'equip bar', 'move r1']).state.won, true);
});

test('lock: kill condition by type and by instance', () => {
  const m = map(`player:
  str: 9
enemies[1]{id,hp,str}:
  rat,3,1
rooms[3]{id,flags,enemies}:
  r0,entry,
  r1,,rat
  r2,exit,
passages[2]{id,a,b,lock}:
  p0,r0,r1,
  p1,r1,r2,kill:rat+kill:r1.1
`);
  assert.equal(play(m, ['move r1', 'fight', 'move r2']).state.won, true);
});
//#endregion

//#region [ Combat ]
const FIGHT = (player, foes, enemies, extra = '') => map(`player:
${player}
enemies[${enemies.length}]{id,hp,str,def,drop,fx}:
${enemies.map(e => '  ' + e).join('\n')}
${extra}rooms[2]{id,flags,enemies}:
  r0,entry,
  r1,exit,${foes}
passages[1]{id,a,b}:
  p0,r0,r1
`);

test('combat: entering starts a fight and blocks leaving', () => {
  const m = FIGHT('  hp: 20\n  str: 5\n  def: 0', 'rat', ['rat,6,2,0,,']);
  const r = play(m, ['move r1']);
  assert.deepEqual(r.state.fight, { wave: 1, turn: false });
  assert.equal(r.state.won, false);
  assert.deepEqual(acts(m, r.state), ['fight']);
  play(m, ['move r1', 'move r0'], /during a fight/);
});

test('combat: damage is max(1, STR-DEF), player hits first', () => {
  // rat 6hp def 0: player str 5 -> 2 hits; rat hits back once (2-0=2)
  const m = FIGHT('  hp: 20\n  str: 5\n  def: 0', 'rat', ['rat,6,2,0,,']);
  const r = play(m, ['move r1', 'fight']);
  assert.equal(r.state.hp, 18);
  assert.equal(r.state.won, true);
});

test('combat: at least 1 damage when DEF is higher', () => {
  const m = FIGHT('  hp: 20\n  str: 1\n  def: 9', 'rat', ['rat,3,2,5,,']);
  const r = play(m, ['move r1', 'fight']);
  // 3 player hits; rat hits twice for 1
  assert.equal(r.state.hp, 18);
});

test('combat: a whole wave fights at once, target in list order', () => {
  const m = FIGHT('  hp: 30\n  str: 4\n  def: 0', 'a+b', ['a,4,3,0,,', 'b,8,1,0,,']);
  const r = play(m, ['move r1', 'fight']);
  // turn 1: kill a -> b hits 1. turn 2: b at 4 -> b hits 1. turn 3: b dies
  assert.equal(r.state.hp, 28);
});

test('combat: waves in order with a prep pause between', () => {
  const m = FIGHT('  hp: 30\n  str: 10\n  def: 0', 'rat:2+bat', ['rat,5,2,0,,', 'bat,5,2,0,,']);
  let r = play(m, ['move r1', 'fight']);
  assert.deepEqual(r.state.fight, { wave: 2, turn: false });
  assert.ok(lines(r).some(l => l.startsWith('wave 1: bat')));
  r = play(m, ['move r1', 'fight', 'fight']);
  assert.equal(r.state.fight, null);
});

test('combat: death ends the route', () => {
  const m = FIGHT('  hp: 5\n  str: 1\n  def: 0', 'ogre', ['ogre,50,9,0,,']);
  const r = play(m, ['move r1', 'fight']);
  assert.equal(r.state.dead, true);
  assert.deepEqual(acts(m, r.state), []);
});

test('combat: drops land in the room', () => {
  const m = FIGHT('  hp: 20\n  str: 9\n  def: 0', 'rat', ['rat,3,1,0,gem,'], 'items[1]{id}:\n  gem\n');
  const r = play(m, ['move r1', 'fight', 'take gem']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['gem']);
  assert.equal(r.state.dead_['r1.1'], 'rat');
});

test('combat: invulnerable enemy alone is a stalemate', () => {
  const m = FIGHT('  hp: 20\n  str: 9\n  def: 0', 'ghost', ['ghost,3,1,0,,ward'], 'effects[1]{id,invuln}:\n  ward,true\n');
  const r = play(m, ['move r1', 'fight']);
  assert.equal(r.state.dead, true);
  assert.ok(lines(r).some(l => l.startsWith('stalemate')));
});

test('combat: player skips invulnerable targets while others live', () => {
  const m = FIGHT('  hp: 20\n  str: 9\n  def: 0', 'ghost+rat', ['ghost,3,1,0,,ward', 'rat,3,1,0,,'], 'effects[1]{id,invuln}:\n  ward,true\n');
  const r = play(m, ['move r1', 'fight']);
  assert.ok(lines(r).includes('r1.2 (rat) dies'));
  assert.equal(r.state.dead, true);
});

test('combat: removing invuln in prep wins the fight', () => {
  const m = FIGHT('  hp: 20\n  str: 9\n  def: 0\n  start[1]: salt', 'ghost', ['ghost,3,1,0,,ward'],
    'effects[1]{id,invuln}:\n  ward,true\nitems[1]{id,uses,delFx,target}:\n  salt,1,ward,one\n');
  const r = play(m, ['move r1', 'use salt>r1.1', 'fight']);
  assert.equal(r.state.won, true);
  assert.deepEqual(r.state.bag, []);
});

test('combat: invulnerable player takes no damage', () => {
  const m = FIGHT('  hp: 5\n  str: 1\n  def: 0\n  fx[1]: shield', 'ogre', ['ogre,10,9,0,,'], 'effects[1]{id,invuln}:\n  shield,true\n');
  const r = play(m, ['move r1', 'fight']);
  assert.equal(r.state.hp, 5);
});

test('combat: both invulnerable is a stalemate', () => {
  const m = FIGHT('  hp: 5\n  fx[1]: w', 'g', ['g,10,9,0,,w'], 'effects[1]{id,invuln}:\n  w,true\n');
  assert.equal(play(m, ['move r1', 'fight']).state.dead, true);
});

test('combat: combatConsumables pauses after each exchange', () => {
  const m = FIGHT('  hp: 30\n  str: 1\n  def: 0', 'rat', ['rat,3,2,0,,'], 'rules:\n  combatConsumables: true\n');
  let r = play(m, ['move r1', 'fight']);
  assert.equal(r.state.fight.turn, true);
  r = play(m, ['move r1', 'fight', 'fight', 'fight']);
  assert.equal(r.state.fight, null);
  assert.equal(r.state.hp, 26);
});

test('combat: equip is allowed in prep but not between turns', () => {
  const m = FIGHT('  hp: 30\n  str: 1\n  def: 0\n  slots[1]{id}:\n    hand\n  start[1]: club', 'rat', ['rat,9,1,0,,'],
    'rules:\n  combatConsumables: true\nitems[1]{id,slot,str}:\n  club,hand,2\n');
  play(m, ['move r1', 'equip club', 'fight']);
  play(m, ['move r1', 'fight', 'equip club'], /between turns/);
});

test('combat: spawn on enter joins the fight', () => {
  const m = FIGHT('  hp: 30\n  str: 10\n  def: 0', 'rat', ['rat,5,2,0,,'], 'events[1]{id,room,do}:\n  ev0,r1,spawn:rat@r1:2\n');
  const r = play(m, ['move r1']);
  assert.equal(r.state.foes.r1.length, 2);
  assert.equal(r.state.foes.r1[1].iid, 'r1.2');
});
//#endregion

//#region [ Items, slots, durability ]
const GEAR = (mode, extra = [], inv = true) => map(`player:
  inventory: ${inv}
  slots[1]{id,mode}:
    hand,${mode}
items[${2 + extra.length}]{id,slot,str,uses,breakOnDrop}:
  a,hand,2,,
  b,hand,3,,
${extra.map(x => '  ' + x + '\n').join('')}rooms[2]{id,flags,items}:
  r0,entry,${['a', 'b', ...extra.map(x => x.split(',')[0])].join('+')}
  r1,exit,
passages[1]{id,a,b}:
  p0,r0,r1
`);

test('equip: bonuses only count while equipped', () => {
  const m = GEAR('free');
  const r = play(m, ['take a']);
  assert.equal(stats(m, r.state).str, 5);
  assert.equal(stats(m, play(m, ['take a', 'equip a']).state).str, 7);
});

test('slot free: swapping sends the old item to the bag', () => {
  const m = GEAR('free');
  const r = play(m, ['take a', 'take b', 'equip a', 'equip b']);
  assert.equal(r.state.slots.hand.id, 'b');
  assert.deepEqual(r.state.bag.map(e => e.id), ['a']);
});

test('slot hold-drop: swapping drops the old item in the room', () => {
  const m = GEAR('hold-drop');
  const r = play(m, ['take a', 'take b', 'equip a', 'equip b']);
  assert.deepEqual(r.state.floor.r0.map(e => e.id), ['a']);
});

test('slot fixed: no swapping, no dropping', () => {
  const m = GEAR('fixed');
  play(m, ['take a', 'take b', 'equip a', 'equip b'], /fixed/);
  play(m, ['take a', 'equip a', 'drop a'], /fixed/);
});

test('slot free: unequip back to the bag', () => {
  const r = play(GEAR('free'), ['take a', 'equip a', 'unequip hand']);
  assert.equal(r.state.slots.hand, null);
});

test('drop: breakOnDrop items are destroyed', () => {
  const m = GEAR('free', ['glass,,,,true']);
  const r = play(m, ['take glass', 'drop glass']);
  assert.equal((r.state.floor.r0 ?? []).some(e => e.id === 'glass'), false);
  assert.ok(lines(r).includes('glass breaks'));
});

test('drop: dropped items can be taken again', () => {
  const r = play(GEAR('free'), ['take a', 'drop a', 'take a']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['a']);
});

test('durability: each room fight costs 1 use, 0 breaks and frees the slot', () => {
  const m = map(`player:
  str: 1
  slots[1]{id,mode}:
    hand,fixed
  start[1]: twig
items[1]{id,slot,str,uses}:
  twig,hand,9,2
enemies[1]{id,hp,str}:
  rat,1,1
rooms[3]{id,flags,enemies}:
  r0,entry,
  r1,,rat
  r2,exit,rat+rat
passages[2]{id,a,b}:
  p0,r0,r1
  p1,r1,r2
`);
  let r = play(m, ['equip twig', 'move r1', 'fight']);
  assert.equal(r.state.slots.hand.u, 1);
  r = play(m, ['equip twig', 'move r1', 'fight', 'move r2', 'fight']);
  assert.equal(r.state.slots.hand, null);
  assert.ok(lines(r).includes('twig breaks'));
});

test('inventory off: items go into slots, free acts like hold-drop', () => {
  const m = GEAR('free', [], false);
  let r = play(m, ['take a']);
  assert.equal(r.state.slots.hand.id, 'a');
  assert.deepEqual(r.state.bag, []);
  assert.ok(acts(m, r.state).includes('take b>hand'));
  r = play(m, ['take a', 'take b>hand']);
  assert.equal(r.state.slots.hand.id, 'b');
  assert.deepEqual(r.state.floor.r0.map(e => e.id), ['a']);
});

test('inventory off: unbound items use any free slot, full slots block taking', () => {
  const m = map(`player:
  inventory: false
  slots[1]{id}:
    pack
items[2]{id}:
  x
  y
rooms[1]{id,flags,items}:
  r0,entry+exit,x+y
`);
  const r = play(m, ['take x']);
  assert.equal(r.state.slots.pack.id, 'x');
  play(m, ['take x', 'take y'], /no free slot/);
  assert.equal(play(m, ['take x', 'take y>pack']).state.slots.pack.id, 'y');
});

test('inventory off: keys work from slots', () => {
  const m = KEYMAP('inf');
  m.player.inventory = false;
  m.player.slots = [{ id: 'belt', mode: 'free' }];
  assert.equal(play(m, ['take k', 'move r1', 'move r2']).state.won, true);
});
//#endregion

//#region [ Use, heal, effects ]
const POT = `player:
  hp: 20
  start[1]: pot
items[1]{id,heal,uses}:
  pot,50,2
rooms[1]{id,flags}:
  r0,entry+exit
`;

test('heal: capped at max hp, charges spent', () => {
  const m = map(POT);
  const s = Rules.init(m);
  s.hp = 5;
  let r = Rules.apply(m, s, { a: 'use', item: 'pot' });
  assert.equal(r.state.hp, 20);
  assert.equal(r.state.bag[0].u, 1);
  r = Rules.apply(m, r.state, { a: 'use', item: 'pot' });
  assert.deepEqual(r.state.bag, []);
});

const FX = `player:
  hp: 20
  str: 5
  def: 1
  slots[1]{id}:
    neck
effects[4]{id,hp,str,def,invuln,dur}:
  buff,10,2,,,2
  aura,,,3,,equip
  curse,-15,,,,perm
  ward,,,,true,perm
items[3]{id,slot,uses,addFx,target}:
  tonic,,1,buff,self
  charm,neck,,aura,self
  hex,,1,curse,self
enemies[1]{id,hp,str}:
  rat,1,1
rooms[3]{id,flags,items,enemies}:
  r0,entry,tonic+charm+hex,
  r1,,,rat
  r2,exit,,rat
passages[2]{id,a,b}:
  p0,r0,r1
  p1,r1,r2
`;

test('effect: flat mods add to max hp and str', () => {
  const m = map(FX);
  const r = play(m, ['take tonic', 'use tonic']);
  const st = stats(m, r.state);
  assert.equal(st.maxhp, 30);
  assert.equal(st.str, 7);
  assert.equal(r.state.hp, 20, 'max hp grows, current hp does not');
});

test('effect: N duration counts room fights', () => {
  const m = map(FX);
  let r = play(m, ['take tonic', 'use tonic', 'move r1', 'fight']);
  assert.deepEqual(r.state.fx, [{ id: 'buff', t: 1 }]);
  r = play(m, ['take tonic', 'use tonic', 'move r1', 'fight', 'move r2', 'fight']);
  assert.deepEqual(r.state.fx, []);
});

test('effect: equip duration only while the item is in a slot', () => {
  const m = map(FX);
  assert.equal(stats(m, play(m, ['take charm']).state).def, 1);
  assert.equal(stats(m, play(m, ['take charm', 'equip charm']).state).def, 4);
  assert.equal(stats(m, play(m, ['take charm', 'equip charm', 'unequip neck']).state).def, 1);
});

test('effect: max hp below current hp drags hp down', () => {
  const m = map(FX);
  const r = play(m, ['take hex', 'use hex']);
  assert.equal(r.state.hp, 5);
});

test('effect: onHit lands on the enemy hit', () => {
  const m = map(`player:
  hp: 50
  str: 2
  slots[1]{id}:
    hand
  start[1]: venom
effects[1]{id,def}:
  soft,-5
items[1]{id,slot,onHit}:
  venom,hand,soft
enemies[1]{id,hp,str,def}:
  crab,12,1,5
rooms[2]{id,flags,enemies}:
  r0,entry,
  r1,exit,crab
passages[1]{id,a,b}:
  p0,r0,r1
`);
  const r = play(m, ['equip venom', 'move r1', 'fight']);
  // hit 1 does 1 and softens (def 0), then 2 per hit: 1 + 2*6 >= 12 -> 7 hits, crab hits back 6 times
  assert.equal(r.state.hp, 44);
});

test('effect: use on all enemies', () => {
  const m = map(`player:
  hp: 50
  str: 3
  start[1]: dust
effects[1]{id,str}:
  sleepy,-10
items[1]{id,uses,addFx,target}:
  dust,1,sleepy,all
enemies[1]{id,hp,str}:
  orc,6,5
rooms[2]{id,flags,enemies}:
  r0,entry,
  r1,exit,orc+orc
passages[1]{id,a,b}:
  p0,r0,r1
`);
  const r = play(m, ['move r1', 'use dust', 'fight']);
  // 4 player hits; the orcs deal 1 each after hits 1-3: 2 + 1 + 1
  assert.equal(r.state.hp, 46);
});
//#endregion

//#region [ Chests, recipes ]
const CRAFT = `items[4]{id,key}:
  a,
  b,
  c,
  k,blue
chests[2]{id,items,lock}:
  c0,a+b,
  c1,c,key:blue
rooms[2]{id,flags,chests,builders,items}:
  r0,entry,c0+c1,,k
  r1,exit,,forge,
recipes[2]{in,out,consume,builder}:
  a+b,c,true,
  c+c,a,false,forge
passages[1]{id,a,b}:
  p0,r0,r1
`;

test('chest: opening puts its items on the floor', () => {
  const r = play(map(CRAFT), ['open c0', 'take a', 'take b']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['a', 'b']);
  assert.deepEqual(r.state.looted, ['c0']);
});

test('chest: locked chest needs its key', () => {
  play(map(CRAFT), ['open c1'], /locked/);
  assert.ok(play(map(CRAFT), ['take k', 'open c1', 'take c']).state.bag.some(e => e.id === 'c'));
});

test('craft: consumes inputs', () => {
  const r = play(map(CRAFT), ['open c0', 'take a', 'take b', 'craft c']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['c']);
});

test('craft: builder must be in the room; consume false keeps inputs', () => {
  const m = map(CRAFT);
  const base = ['open c0', 'take a', 'take b', 'craft c', 'take k', 'open c1', 'take c'];
  play(m, [...base, 'craft a/1'], /builder/);
  const r = play(m, [...base, 'move r1', 'craft a/1']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['a', 'c', 'c']);
});
//#endregion

//#region [ Events ]
const EV = (events, extra = '') => map(`player:
  hp: 30
  str: 9
${extra}items[1]{id}:
  gem
effects[1]{id,str}:
  might,5
enemies[1]{id,hp,str,drop}:
  rat,3,1,gem
rooms[3]{id,flags,enemies}:
  r0,entry,
  r1,,rat
  r2,exit,
passages[2]{id,a,b}:
  p0,r0,r1
  p1,r0,r2
events[${events.length}]{id,room,on,once,if,do}:
${events.map(e => '  ' + e).join('\n')}
`);

test('event: give on enter', () => {
  const r = play(EV(['ev0,r2,enter,true,,give:gem']), ['move r2']);
  assert.deepEqual(r.state.bag.map(e => e.id), ['gem']);
});

test('event: once fires a single time, repeatable fires each time', () => {
  assert.equal(play(EV(['ev0,r2,enter,true,,give:gem']), ['move r2', 'move r0', 'move r2']).state.bag.length, 1);
  assert.equal(play(EV(['ev0,r2,enter,false,,give:gem']), ['move r2', 'move r0', 'move r2']).state.bag.length, 2);
});

test('event: take on leave', () => {
  const r = play(EV(['ev0,r2,enter,true,,give:gem', 'ev1,r2,leave,true,,take:gem']), ['move r2', 'move r0']);
  assert.deepEqual(r.state.bag, []);
});

test('event: lock seals an open passage, unlock opens it', () => {
  const m = EV(['ev0,r2,leave,true,,lock:p1', 'ev1,r1,enter,true,,unlock:p1']);
  play(m, ['move r2', 'move r0', 'move r2'], /no open way/);
});

test('event: condition fails now, fires on a later visit', () => {
  const m = EV(['ev0,r0,enter,true,item:gem,fx+:might@player', 'ev1,r2,enter,true,,give:gem']);
  const r = play(m, ['move r2', 'move r0']);
  assert.deepEqual(r.state.fx.map(f => f.id), ['might']);
});

test('event: kill removes enemies without a fight and drops loot', () => {
  const r = play(EV(['ev0,r2,enter,true,,kill:rat']), ['move r2', 'move r0', 'move r1']);
  assert.equal(r.state.fight, null);
  assert.deepEqual(r.state.floor.r1.map(e => e.id), ['gem']);
});

test('event: fx on a specific enemy instance', () => {
  const m = EV(['ev0,r0,leave,true,,fx+:might@r1.1']);
  const r = play(m, ['move r1']);
  assert.deepEqual(r.state.foes.r1[0].fx, ['might']);
});

test('event: fx- removes a player effect', () => {
  const m = EV(['ev0,r2,enter,true,,fx-:might@player'], '  fx[1]: might\n');
  assert.deepEqual(play(m, ['move r2']).state.fx, []);
});

test('event: spawn into another room', () => {
  const r = play(EV(['ev0,r2,enter,true,,spawn:rat@r0']), ['move r2', 'move r0']);
  assert.ok(r.state.fight);
});

test('event: leave events run before enter events', () => {
  const m = EV(['ev0,r0,leave,true,,give:gem', 'ev1,r2,enter,true,item:gem,fx+:might@player']);
  assert.deepEqual(play(m, ['move r2']).state.fx.map(f => f.id), ['might']);
});
//#endregion

//#region [ Text form ]
test('action strings round-trip', () => {
  const m = map(CRAFT);
  for(const s of ['move r1', 'take a', 'take a>hand', 'use x>r1.2', 'use x', 'unequip neck', 'open c0', 'craft a/1', 'fight', 'equip a', 'drop a'])
    assert.equal(Rules.actionStr(Rules.parseAction(m, s)), s);
  assert.equal(Rules.parseAction(m, 'craft c').r, 0);
});

test('replay reports the failing step', () => {
  const r = Rules.replay(two(), ['move r1', 'move r5']);
  assert.equal(r.at, 1);
});

test('apply does not change the input state', () => {
  const m = map(CRAFT);
  const s = Rules.init(m);
  const before = Rules.key(s, true);
  Rules.apply(m, s, { a: 'open', chest: 'c0' });
  assert.equal(Rules.key(s, true), before);
});
//#endregion
