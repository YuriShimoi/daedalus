// Right panel: selection form (room or passage), player, entity tables, rules & score.
class Inspector {
  static TABS = [
    ['room', 'Room'], ['player', 'Player'], ['items', 'Items'], ['enemies', 'Enemies'], ['effects', 'Effects'],
    ['recipes', 'Recipes'], ['events', 'Events'], ['rules', 'Rules & Score'],
  ];

  /** New entities: default fields and id prefix. */
  static BLANK = {
    items: ['i', () => ({ slot: null, hp: 0, str: 0, def: 0, uses: null, heal: 0, key: null, keyUses: 1,
      breakOnDrop: false, addFx: [], delFx: [], target: 'self', onHit: [], weight: null })],
    enemies: ['e', () => ({ hp: 5, str: 2, def: 0, drop: [], fx: [], weight: null })],
    effects: ['f', () => ({ hp: 0, str: 0, def: 0, invuln: false, dur: 'perm' })],
    chests: ['c', () => ({ items: [], lock: [] })],
  };
  static #focus = null;     // field key to focus after the next render (a row just added)

  /** Focus this field (data-f key) once the pane re-renders. */
  static focusNext(key) {
    Inspector.#focus = key;
    Tables.expand(key);
  }

  static init() {
    const $tabs = document.getElementById('tabs');
    $tabs.innerHTML = Inspector.TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('');
    $tabs.querySelectorAll('button').forEach($b => { $b.onclick = () => Inspector.show($b.dataset.tab); });
  }

  static show(tab) {
    App.tab = tab;
    Inspector.render();
  }

  static render() {
    const tab = App.tab === 'passage' ? 'room' : App.tab;
    document.querySelectorAll('#tabs button').forEach($b => $b.classList.toggle('on', $b.dataset.tab === tab));
    // keep focus on the same field across the re-render
    const focus = document.activeElement?.closest?.('#pane') ? document.activeElement.dataset.f : null;
    const $p = document.getElementById('pane');
    $p.innerHTML = '';
    ({ room: Inspector.#selection, player: Inspector.#player, items: Inspector.#items, enemies: Inspector.#enemies,
      effects: Inspector.#effects, recipes: Inspector.#recipes, events: Inspector.#events, rules: Inspector.#rules })[tab]($p);
    const added = Inspector.#focus;
    Inspector.#focus = null;
    const $f = (added || focus) && $p.querySelector(`[data-f="${CSS.escape(added || focus)}"]`);
    $f?.focus();
    if(added && $f) {
      $f.select?.();
      $f.scrollIntoView({ block: 'nearest' });
    }
  }

  static #section($p, title, onAdd) {
    const $h = document.createElement('div');
    $h.className = 'section';
    $h.textContent = title;
    if(onAdd) {
      const $b = document.createElement('button');
      $b.className = 'add';
      $b.title = 'Add';
      $b.innerHTML = DAE.Icons.html('plus');
      $b.onclick = onAdd;
      $h.append($b);
    }
    $p.append($h);
    const $box = document.createElement('div');
    $p.append($box);
    return $box;
  }

  static #bad() {
    return new Set(App.issues.errors.map(e => e.at));
  }

  static #nextId(list, prefix) {
    let n = list.length;
    while(list.some(x => x.id === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  //#region [ Selection: room or passage ]
  static #selection($p) {
    const m = App.model;
    const room = m.rooms.find(r => r.id === App.selected);
    const g = m.passages.find(x => x.id === App.selected);
    if(room) return Inspector.#room($p, room);
    if(g) return Inspector.#passage($p, g);
    $p.innerHTML = '<div class="empty">Select a room or passage on the graph, or double-click empty space to add a room.</div>';
  }

  static #room($p, r) {
    const bad = Inspector.#bad().has(r.id);
    const $form = document.createElement('div');
    $form.className = 'top-form';
    $p.append($form);
    Tables.form($form, [
      { key: 'id', label: 'ID', value: r.id, bad },
      { type: 'checks', label: 'Flags', items: [{ key: 'entry', label: 'entry', value: r.entry }, { key: 'exit', label: 'exit', value: r.exit }] },
      { key: 'mark', label: 'Mark', type: 'select', options: DAE.Model.MARKS, value: r.mark },
      { key: 'weight', label: 'Weight', type: 'num', value: r.weight },
    ], (key, v) => App.edit(m => {
      const x = m.rooms.find(q => q.id === r.id);
      if(key === 'id') return Inspector.rename(m, 'room', r.id, v.trim());
      if(key === 'entry' || key === 'exit') x[key] = v;
      else if(key === 'mark') x.mark = v;
      else if(key === 'weight') x.weight = Tables.num(v);
    }));
    Inspector.#contents($p, r);
    Inspector.#eventCards(Inspector.#section($p, 'Events here', () => Inspector.addEvent(r.id)), App.model.events.filter(e => e.room === r.id), false);
    Inspector.#deleteButton($p, `Delete room ${r.id}`);
  }

  //#region [ Room contents ]
  static CONTENTS = [
    { key: 'enemies', title: 'Enemies here', icon: 'skull' },
    { key: 'items', title: 'Items here', icon: 'gem' },
    { key: 'chests', title: 'Chests here', icon: 'chest' },
    { key: 'builders', title: 'Builders here', icon: 'hammer' },
  ];

  /** Enemies, items, chests and builders placed in the room, one row card each (field keys c:<kind>:<i>:<v|wave>). */
  static #contents($p, r) {
    const m = App.model;
    for(const k of Inspector.CONTENTS) {
      const $box = Inspector.#section($p, k.title, () => Inspector.#addContent(r.id, k.key));
      const list = r[k.key];
      if(!list.length) {
        $box.innerHTML = '<div class="empty">None.</div>';
        continue;
      }
      const known = k.key === 'builders' ? null : m[k.key].map(x => x.id);
      $box.innerHTML = `<div class="cards">${list.map((x, i) => {
        const v = k.key === 'enemies' ? x.type : x, key = `c:${k.key}:${i}`;
        const main = known
          ? Tables.input({ key: key + ':v', type: 'select', options: known.includes(v) ? known : [v, ...known], value: v, bad: !known.includes(v) })
          : Tables.input({ key: key + ':v', value: v, placeholder: 'builder name' });
        let extra = '';
        if(k.key === 'enemies') extra = `<label class="fld inline" title="wave"><span>wave</span>${Tables.input({ key: key + ':wave', type: 'num', value: x.wave })}</label><span class="muted" title="instance id">${Tables.esc(r.id)}.${i + 1}</span>`;
        if(k.key === 'chests') {
          const c = m.chests.find(q => q.id === v);
          if(c) extra = `<span class="muted sum">${Tables.esc(c.items.join(', ') || 'empty')}${c.lock.length ? ' · locked' : ''}</span>`;
        }
        return `<div class="rowcard">${k.key === 'items' ? Tables.itemIcon(v, k.icon) : DAE.Icons.html(k.icon)}${main}${extra}<button class="del" data-del="${i}" title="Remove">${DAE.Icons.html('trash')}</button></div>`;
      }).join('')}</div>`;
      $box.querySelectorAll('[data-f]').forEach($i => {
        $i.onchange = () => App.edit(mm => {
          const [, kind, i, f] = $i.dataset.f.split(':');
          const x = mm.rooms.find(q => q.id === r.id)[kind];
          if(kind === 'enemies') f === 'wave' ? x[i].wave = Tables.num($i.value, 1) : x[i].type = $i.value;
          else x[i] = $i.value.trim();
        });
      });
      $box.querySelectorAll('[data-del]').forEach($b => {
        $b.onclick = () => App.edit(mm => { mm.rooms.find(q => q.id === r.id)[k.key].splice(+$b.dataset.del, 1); });
      });
    }
  }

  /** + on a contents section: the first defined entity (a new blank one if there is none yet), editable in place. */
  static #addContent(id, kind) {
    App.edit(m => {
      const x = m.rooms.find(q => q.id === id);
      let ref;
      if(kind === 'builders') ref = m.recipes.find(q => q.builder)?.builder ?? 'builder';
      else {
        ref = m[kind][0]?.id;
        if(!ref) {
          const [prefix, blank] = Inspector.BLANK[kind];
          ref = Inspector.#nextId(m[kind], prefix);
          m[kind].push({ ...blank(), id: ref });
        }
      }
      x[kind].push(kind === 'enemies' ? { type: ref, wave: 1 } : ref);
      Inspector.focusNext(`c:${kind}:${x[kind].length - 1}:v`);
    });
  }
  //#endregion

  static #passage($p, g) {
    const rooms = App.model.rooms.map(r => r.id);
    Tables.form(Inspector.#section($p, `Passage ${g.id}`), [
      { key: 'id', label: 'ID', value: g.id },
      { key: 'a', label: 'From (a)', type: 'select', options: rooms, value: g.a },
      { key: 'b', label: 'To (b)', type: 'select', options: rooms, value: g.b },
      { key: 'dir', label: 'Direction', type: 'select', options: ['both', 'a>b'], value: g.dir },
      { key: 'lock', label: 'Lock', value: Tables.condStr(g.lock), placeholder: 'key:red+kill:ogre', title: 'key:<color> item:<id> kill:<enemy> stat:<str>=<n>, joined with +' },
    ], (key, v) => App.edit(m => {
      const x = m.passages.find(q => q.id === g.id);
      if(key === 'id') return Inspector.rename(m, 'passage', g.id, v.trim());
      x[key] = key === 'lock' ? Tables.conds(v) : v;
    }));
    $p.insertAdjacentHTML('beforeend', '<p class="note">Lock conditions are all required. Opening a key lock spends one key use; once open it stays open.</p>');
    Inspector.#deleteButton($p, `Delete passage ${g.id}`);
  }

  static #deleteButton($p, label) {
    const $b = document.createElement('button');
    $b.innerHTML = `${DAE.Icons.html('trash')} ${label}`;
    $b.style.marginTop = '14px';
    $b.onclick = () => Inspector.deleteSelected();
    $p.append($b);
  }

  /** @param {object} [extra] - settings to copy onto the new room (paste / duplicate) */
  static addRoom(at, extra = {}) {
    App.edit(m => {
      const id = Inspector.#nextId(m.rooms, 'r');
      m.rooms.push({ id, entry: false, exit: false, weight: 0, mark: 'none', enemies: [], items: [], chests: [], builders: [], ...extra });
      App.pos.set(id, { x: Math.round(at.x), y: Math.round(at.y) });
      App.selected = id;
      App.tab = 'room';
    });
  }

  /** Drag from a room into empty space: a new room there, linked to the source room. */
  static addLinkedRoom(from, at) {
    App.edit(m => {
      const id = Inspector.#nextId(m.rooms, 'r');
      m.rooms.push({ id, entry: false, exit: false, weight: 0, mark: 'none', enemies: [], items: [], chests: [], builders: [] });
      m.passages.push({ id: Inspector.#nextId(m.passages, 'p'), a: from, b: id, dir: 'both', lock: [] });
      App.pos.set(id, { x: Math.round(at.x), y: Math.round(at.y) });
      App.selected = id;
      App.tab = 'room';
    });
  }

  /** New room in the middle of a passage: a-b becomes a-new (keeps the lock) and new-b, both with its direction. */
  static splitPassage(pid) {
    App.edit(m => {
      const g = m.passages.find(q => q.id === pid);
      const pa = App.pos.get(g.a), pb = App.pos.get(g.b);
      const id = Inspector.#nextId(m.rooms, 'r');
      m.rooms.push({ id, entry: false, exit: false, weight: 0, mark: 'none', enemies: [], items: [], chests: [], builders: [] });
      m.passages.push({ id: Inspector.#nextId(m.passages, 'p'), a: id, b: g.b, dir: g.dir, lock: [] });
      g.b = id;
      App.pos.set(id, Graph.snap({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }));
      App.selected = id;
      App.tab = 'room';
    });
  }

  static addPassage(a, b) {
    App.edit(m => {
      const id = Inspector.#nextId(m.passages, 'p');
      m.passages.push({ id, a, b, dir: 'both', lock: [] });
      App.selected = id;
      App.tab = 'passage';
    });
  }

  static deleteSelected(id = App.selected) {
    App.edit(m => {
      if(m.rooms.some(r => r.id === id)) {
        m.rooms = m.rooms.filter(r => r.id !== id);
        m.passages = m.passages.filter(g => g.a !== id && g.b !== id);
        m.events = m.events.filter(e => e.room !== id);
      }
      else m.passages = m.passages.filter(g => g.id !== id);
      App.selected = null;
    });
  }
  //#endregion

  //#region [ Player ]
  static #player($p) {
    const pl = App.model.player;
    Tables.form(Inspector.#section($p, 'Player'), [
      { key: 'hp', label: 'HP', type: 'num', value: pl.hp },
      { key: 'str', label: 'STR', type: 'num', value: pl.str },
      { key: 'def', label: 'DEF', type: 'num', value: pl.def },
      { type: 'checks', label: 'Inventory', items: [{ key: 'inventory', label: 'bag on (off: slots only)', value: pl.inventory }] },
      { key: 'start', label: 'Start items', value: pl.start.join('+') },
      { key: 'fx', label: 'Start effects', value: pl.fx.join('+') },
    ], (key, v) => App.edit(m => {
      const x = m.player;
      if(key === 'inventory') x.inventory = v;
      else if(key === 'start' || key === 'fx') x[key] = Tables.list(v);
      else x[key] = Tables.num(v);
    }));
    Tables.table(Inspector.#section($p, 'Slots', () => App.edit(m => {
      m.player.slots.push({ id: Inspector.#nextId(m.player.slots, 'slot'), mode: 'free' });
      Inspector.focusNext(`slot:${m.player.slots.length - 1}:id`);
    })), {
      rows: pl.slots, ns: 'slot',
      cols: [{ key: 'id', label: 'ID' }, { key: 'mode', label: 'Mode', type: 'select', options: DAE.Model.SLOT_MODES }],
      onEdit: (i, key, v) => App.edit(m => {
        if(key === 'id') return Inspector.rename(m, 'slot', m.player.slots[i].id, v.trim());
        m.player.slots[i][key] = v;
      }),
      onDelete: i => App.edit(m => { m.player.slots.splice(i, 1); }),
    });
    $p.insertAdjacentHTML('beforeend', '<p class="note">fixed: stays until it breaks · hold-drop: swapping drops the old item · free: swapping sends it to the bag (acts like hold-drop with the bag off).</p>');
  }
  //#endregion

  //#region [ Entity tables ]
  static #entityTable($p, title, key, cols) {
    const rows = App.model[key];
    const [prefix, blank] = Inspector.BLANK[key];
    Tables.table(Inspector.#section($p, title, () => App.edit(m => {
      m[key].push({ ...blank(), id: Inspector.#nextId(m[key], prefix) });
      Inspector.focusNext(`${key}:${m[key].length - 1}:id`);
    })), {
      rows, cols, bad: Inspector.#bad(), ns: key, icon: key === 'items' ? r => Tables.itemIcon(r.id) : null, collapse: key === 'items',
      onEdit: (i, k, v) => App.edit(m => {
        const col = cols.find(c => c.key === k);
        if(k === 'id') return Inspector.rename(m, title.toLowerCase().replace(/s$/, ''), m[key][i].id, v.trim());
        if(col.set) col.set(m[key][i], v);
        else m[key][i][k] = col.type === 'num' ? Tables.num(v) : v;
      }),
      onDelete: i => App.edit(m => { m[key].splice(i, 1); }),
    });
  }

  static #items($p) {
    const effects = App.model.effects.map(f => f.id);
    const fx = (k, label, title) => ({ key: k, label, title, type: 'chips', options: effects, icon: () => DAE.Icons.html('flask'), set: (r, v) => { r[k] = v; } });
    const opt = (k, label) => ({ key: k, label, type: 'num', get: r => r[k] ?? '', set: (r, v) => { r[k] = Tables.num(v, null); } });
    Inspector.#entityTable($p, 'Items', 'items', [
      { key: 'id', label: 'ID' },
      { key: 'slot', label: 'Slot', type: 'select', options: ['', ...App.model.player.slots.map(s => s.id)], get: r => r.slot ?? '', set: (r, v) => { r.slot = v || null; } },
      { key: 'hp', label: 'HP', type: 'num' }, { key: 'str', label: 'STR', type: 'num' }, { key: 'def', label: 'DEF', type: 'num' },
      opt('uses', 'Uses'), { key: 'heal', label: 'Heal', type: 'num' },
      opt('weight', 'Weight'),
      { key: 'target', label: 'Used on', type: 'select', title: 'who heal and the use effects apply to when the item is used',
        options: [['self', 'player'], ['one', 'one enemy'], ['all', 'all enemies']] },
      { key: 'keyUses', label: 'Key uses', title: 'locks it can open: inf or N', show: r => !!r.key,
        set: (r, v) => { r.keyUses = v.trim() === 'inf' ? 'inf' : Tables.num(v, 1); } },
      fx('addFx', 'Use adds effects', 'effects added to the target when used'),
      fx('delFx', 'Use removes effects', 'effects removed from the target when used'),
      fx('onHit', 'Hit inflicts effects', 'while equipped: effects put on the enemy the player hits'),
      { key: 'key', type: 'bool', get: r => !!r.key, set: (r, v) => { r.key = v ? Inspector.#newKey() : null; },
        label: r => r.key ? `key ${Tables.itemIcon(r.id)}<b>${Tables.esc(r.key)}</b> <span class="muted">(locks use key:${Tables.esc(r.key)})</span>` : 'is a key',
        title: 'opens passage and chest locks of its key color' },
      { key: 'breakOnDrop', label: 'breaks when dropped', type: 'bool' },
    ]);
    Tables.table(Inspector.#section($p, 'Chests', () => App.edit(m => {
      m.chests.push({ id: Inspector.#nextId(m.chests, 'c'), items: [], lock: [] });
      Inspector.focusNext(`chests:${m.chests.length - 1}:id`);
    })), {
      rows: App.model.chests, bad: Inspector.#bad(), ns: 'chests',
      cols: [{ key: 'id', label: 'ID' }, { key: 'items', label: 'Items', get: r => r.items.join('+'), wide: true, placeholder: 'sword+potion' },
        { key: 'lock', label: 'Lock', get: r => Tables.condStr(r.lock), wide: true, placeholder: 'key:red' }],
      onEdit: (i, k, v) => App.edit(m => {
        if(k === 'id') return Inspector.rename(m, 'chest', m.chests[i].id, v.trim());
        m.chests[i][k] = k === 'lock' ? Tables.conds(v) : Tables.list(v);
      }),
      onDelete: i => App.edit(m => { m.chests.splice(i, 1); }),
    });
    $p.insertAdjacentHTML('beforeend', '<p class="note">Lists join with +. Uses empty = unlimited. Key uses: inf or N. Put a chest in a room from the Room tab.</p>');
  }

  static #enemies($p) {
    Inspector.#entityTable($p, 'Enemies', 'enemies', [
      { key: 'id', label: 'ID' }, { key: 'hp', label: 'HP', type: 'num' }, { key: 'str', label: 'STR', type: 'num' }, { key: 'def', label: 'DEF', type: 'num' },
      { key: 'drop', label: 'Drops', get: r => r.drop.join('+'), set: (r, v) => { r.drop = Tables.list(v); } },
      { key: 'fx', label: 'Effects', get: r => r.fx.join('+'), set: (r, v) => { r.fx = Tables.list(v); } },
      { key: 'weight', label: 'Weight', type: 'num', get: r => r.weight ?? '', set: (r, v) => { r.weight = Tables.num(v, null); } },
    ]);
  }

  /** Field label plus the key icon and color when the item is a key. */
  static #keyLabel(label, id) {
    const k = App.model.items.find(t => t.id === id)?.key;
    return k ? `${label} ${Tables.itemIcon(id)}<b class="keyname" style="color:${DAE.Svg.keyColor(k)}">key ${Tables.esc(k)}</b>` : label;
  }

  /** Key id for a new key item: the first unused color name, so it gets a distinct color. */
  static #newKey() {
    const used = new Set(App.model.items.map(t => t.key).filter(Boolean));
    const free = ['red', 'blue', 'green', 'gold', 'pink', 'orange', 'cyan'].find(c => !used.has(c));
    let n = used.size;
    while(used.has(`key${n}`)) n++;
    return free ?? `key${n}`;
  }

  static #effects($p) {
    Inspector.#entityTable($p, 'Effects', 'effects', [
      { key: 'id', label: 'ID' }, { key: 'hp', label: 'Max HP', type: 'num' }, { key: 'str', label: 'STR', type: 'num' }, { key: 'def', label: 'DEF', type: 'num' },
      { key: 'dur', label: 'Duration', title: 'perm, equip or N room fights', set: (r, v) => { r.dur = /^\d+$/.test(v.trim()) ? +v : v.trim(); } },
      { key: 'invuln', label: 'invulnerable', type: 'bool' },
    ]);
    $p.insertAdjacentHTML('beforeend', '<p class="note">Flat changes. Duration: perm · N (room fights) · equip (while the item is equipped). Invulnerable takes 0 damage.</p>');
  }

  static #recipes($p) {
    const rows = App.model.recipes;
    const items = App.model.items.map(t => t.id);
    const builders = [...new Set(App.model.rooms.flatMap(r => r.builders))];
    const keep = (opts, v) => opts.includes(v) ? opts : [...opts, v];   // an unknown value stays visible
    Tables.table(Inspector.#section($p, 'Recipes', () => App.edit(m => {
      m.recipes.push({ in: [], out: '', consume: true, builder: null });
      Inspector.focusNext(`rec:${m.recipes.length - 1}:in`);   // the inputs' add select
    })), {
      rows, ns: 'rec',
      cols: [{ key: 'in', label: 'Inputs', type: 'chips', options: items, icon: id => Tables.itemIcon(id, 'gem') },
        { key: 'out', label: r => Inspector.#keyLabel('Output', r.out), type: 'select', get: r => r.out, options: r => keep(['', ...items], r.out) },
        { key: 'builder', label: 'Builder', type: 'select', get: r => r.builder ?? '', options: r => keep(['', ...builders], r.builder ?? '') },
        { key: 'consume', label: 'consumes inputs', type: 'bool' }],
      onEdit: (i, k, v) => App.edit(m => {
        const r = m.recipes[i];
        if(k === 'in') r.in = v;
        else if(k === 'builder') r.builder = v || null;
        else r[k] = v;
      }),
      onDelete: i => App.edit(m => { m.recipes.splice(i, 1); }),
    });
  }

  static #events($p) {
    Inspector.#eventCards(Inspector.#section($p, 'Events', () => Inspector.addEvent(App.model.rooms[0]?.id)), App.model.events, true);
    $p.insertAdjacentHTML('beforeend', `<p class="note">Actions (join with +): lock:&lt;passage|chest&gt; · unlock:… · give:&lt;item&gt; · take:&lt;item&gt; ·
      fx+:&lt;effect&gt;@&lt;target&gt; · fx-:… · spawn:&lt;enemy&gt;@&lt;room&gt;[:wave] · kill:&lt;target&gt;. Targets: player, an enemy type, or an instance like r2.1.</p>`);
  }

  /** Event cards; rows are model events, so field keys use their index in the whole list. */
  static #eventCards($box, rows, withRoom) {
    Tables.table($box, {
      rows, ns: 'ev', bad: Inspector.#bad(), index: r => App.model.events.indexOf(r),
      cols: [{ key: 'id', label: 'ID' }, ...(withRoom ? [{ key: 'room', label: 'Room', type: 'select', options: App.model.rooms.map(r => r.id) }] : []),
        { key: 'on', label: 'On', type: 'select', options: ['enter', 'leave'] },
        { key: 'if', label: 'If', get: r => Tables.condStr(r.if), wide: true, placeholder: 'key:red+kill:ogre' },
        { key: 'do', label: 'Do', get: r => r.do.map(DAE.Model.actionStr).join('+'), wide: true, placeholder: 'unlock:p1+give:potion' },
        { key: 'once', label: 'once', type: 'bool' }],
      onEdit: (i, k, v) => App.edit(m => {
        const e = m.events[i];
        if(k === 'id') return Inspector.rename(m, 'event', e.id, v.trim());
        if(k === 'if') e.if = Tables.conds(v);
        else if(k === 'do') e.do = DAE.Model.actionList(v);
        else e[k] = v;
      }),
      onDelete: i => App.edit(m => { m.events.splice(i, 1); }),
    });
  }

  /** Adds an event, editable in place in the current tab. */
  static addEvent(room) {
    App.edit(m => {
      m.events.push({ id: Inspector.#nextId(m.events, 'ev'), room, on: 'enter', once: true, if: [], do: [] });
      Inspector.focusNext(`ev:${m.events.length - 1}:do`);
    });
  }
  //#endregion

  //#region [ Rules & score, issues ]
  static #rules($p) {
    const { rules, score } = App.model;
    Tables.form(Inspector.#section($p, 'Rules'), [
      { type: 'checks', label: 'Combat', items: [{ key: 'combatConsumables', label: 'use items between turns', value: rules.combatConsumables }] },
      { key: 'maxRoomVisits', label: 'Max visits', type: 'num', value: rules.maxRoomVisits, title: 'per room, transit included (solver guard)' },
      { key: 'timeLimitMs', label: 'Time limit ms', type: 'num', value: rules.timeLimitMs },
    ], (k, v) => App.edit(m => { m.rules[k] = typeof v === 'boolean' ? v : Tables.num(v); }));
    Tables.form(Inspector.#section($p, 'Score'), [
      { key: 'mode', label: 'Mode', type: 'select', options: ['safe', 'weighted'], value: score.mode },
      ...Object.keys(DAE.Model.WEIGHTS).map(k => ({ key: 'w.' + k, label: `w ${k}`, type: 'num', value: score.w[k] })),
    ], (k, v) => App.edit(m => {
      if(k === 'mode') m.score.mode = v;
      else m.score.w[k.slice(2)] = Tables.num(v);
    }));
    const { errors, warnings } = App.issues;
    const $i = Inspector.#section($p, 'Validation');
    $i.className = 'issues-list';
    $i.innerHTML = !errors.length && !warnings.length ? '<div class="empty">No problems found.</div>'
      : [...errors.map(e => `<div class="e">${DAE.Icons.html('circle-xmark')} ${Tables.esc(e.msg)}</div>`),
        ...warnings.map(w => `<div class="w">${DAE.Icons.html('triangle-exclamation')} ${Tables.esc(w.msg)}</div>`)].join('');
  }
  //#endregion

  //#region [ Renaming ]
  /** Renames an id and the references to it that the model can name. */
  static rename(m, kind, from, to) {
    if(!to || to === from) return;
    const swap = list => list.map(x => x === from ? to : x);
    const conds = list => list.forEach(c => { if(c.v === from) c.v = to; });
    const acts = list => list.forEach(a => {
      if(a.v === from) a.v = to;
      if(a.target === from) a.target = to;
      if(a.room === from) a.room = to;
      if(kind === 'room' && typeof a.target === 'string' && a.target.startsWith(from + '.')) a.target = to + a.target.slice(from.length);
      if(kind === 'room' && a.v.startsWith?.(from + '.')) a.v = to + a.v.slice(from.length);
    });
    const each = fn => { m.passages.forEach(g => fn(g.lock)); m.chests.forEach(c => fn(c.lock)); m.events.forEach(e => fn(e.if)); };
    switch(kind) {
      case 'room': {
        m.rooms.find(r => r.id === from).id = to;
        m.passages.forEach(g => { if(g.a === from) g.a = to; if(g.b === from) g.b = to; });
        m.events.forEach(e => { if(e.room === from) e.room = to; acts(e.do); });
        if(App.pos.has(from)) { App.pos.set(to, App.pos.get(from)); App.pos.delete(from); }
        if(App.selected === from) App.selected = to;
        break;
      }
      case 'passage':
        m.passages.find(g => g.id === from).id = to;
        m.events.forEach(e => acts(e.do));
        if(App.selected === from) App.selected = to;
        break;
      case 'chest':
        m.chests.find(c => c.id === from).id = to;
        m.rooms.forEach(r => { r.chests = swap(r.chests); });
        m.events.forEach(e => acts(e.do));
        break;
      case 'item':
        m.items.find(t => t.id === from).id = to;
        m.rooms.forEach(r => { r.items = swap(r.items); });
        m.chests.forEach(c => { c.items = swap(c.items); });
        m.enemies.forEach(e => { e.drop = swap(e.drop); });
        m.recipes.forEach(r => { r.in = swap(r.in); if(r.out === from) r.out = to; });
        m.player.start = swap(m.player.start);
        each(conds);
        m.events.forEach(e => acts(e.do));
        break;
      case 'enemie':
      case 'enemy':
        m.enemies.find(e => e.id === from).id = to;
        m.rooms.forEach(r => r.enemies.forEach(f => { if(f.type === from) f.type = to; }));
        each(conds);
        m.events.forEach(e => acts(e.do));
        break;
      case 'effect':
        m.effects.find(f => f.id === from).id = to;
        m.items.forEach(t => { t.addFx = swap(t.addFx); t.delFx = swap(t.delFx); t.onHit = swap(t.onHit); });
        m.enemies.forEach(e => { e.fx = swap(e.fx); });
        m.player.fx = swap(m.player.fx);
        m.events.forEach(e => acts(e.do));
        break;
      case 'slot':
        m.player.slots.find(s => s.id === from).id = to;
        m.items.forEach(t => { if(t.slot === from) t.slot = to; });
        break;
      case 'event':
        m.events.find(e => e.id === from).id = to;
        break;
    }
  }
  //#endregion
}
