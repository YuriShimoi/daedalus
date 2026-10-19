// Right-click menu on the graph: room, passage or empty-space actions (edit mode only).
class Menu {
  static #$el = null;
  static #clip = { room: null, lock: null };   // copied room settings / passage lock

  /** Room fields copied by "Copy settings" (id, flags, position and chests stay with the room). */
  static ROOM_KEYS = ['weight', 'mark', 'enemies', 'items', 'builders'];

  static open(e, hit, at) {
    Menu.close();
    if(App.mode !== 'edit') return;
    const items = hit?.kind === 'room' ? Menu.#roomItems(hit.id, at)
      : hit?.kind === 'passage' ? Menu.#passageItems(hit.id)
      : Menu.#canvasItems(at);
    if(hit) App.select(hit.id);

    const $m = Menu.#$el = document.createElement('div');
    $m.className = 'ctx';
    for(const it of items) {
      if(it === '-') { $m.insertAdjacentHTML('beforeend', '<hr>'); continue; }
      if(typeof it === 'string') { $m.insertAdjacentHTML('beforeend', `<h4>${Tables.esc(it)}</h4>`); continue; }
      const [icon, label, fn, o = {}] = it;
      const $b = document.createElement('button');
      $b.className = [o.on && 'on', o.danger && 'danger'].filter(Boolean).join(' ');
      $b.disabled = !!o.disabled;
      $b.innerHTML = `${icon ? DAE.Icons.html(icon) : '<i></i>'}<span>${Tables.esc(label)}</span>${o.key ? `<kbd>${o.key}</kbd>` : ''}`;
      $b.onclick = () => { Menu.close(); fn(); };
      $m.append($b);
    }
    document.body.append($m);

    // keep it inside the window
    const r = $m.getBoundingClientRect();
    $m.style.left = Math.min(e.clientX, innerWidth - r.width - 4) + 'px';
    $m.style.top = Math.min(e.clientY, innerHeight - r.height - 4) + 'px';
  }

  static close() {
    Menu.#$el?.remove();
    Menu.#$el = null;
  }

  static init() {
    document.addEventListener('mousedown', e => { if(!e.target.closest?.('.ctx')) Menu.close(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape') Menu.close(); });
    window.addEventListener('blur', Menu.close);
    window.addEventListener('resize', Menu.close);
    document.getElementById('graph').addEventListener('wheel', Menu.close);
  }

  //#region [ Items ]
  static #roomItems(id, at) {
    const r = App.model.rooms.find(q => q.id === id);
    const room = fn => App.edit(m => fn(m.rooms.find(q => q.id === id), m));
    const p = App.pos.get(id) ?? at;
    return [
      `Room ${id}`,
      ['link', 'Add linked room', () => Inspector.addLinkedRoom(id, Graph.snap({ x: p.x + DAE.Layout.GAP, y: p.y }))],
      ['clone', 'Duplicate', () => Menu.#pasteRoom(Graph.snap({ x: p.x + Graph.GRID, y: p.y + Graph.GRID }), Menu.#settings(r))],
      ['copy', 'Copy settings', () => Menu.#clip.room = Menu.#settings(r)],
      ['paste', 'Paste settings', () => room(x => Object.assign(x, structuredClone(Menu.#clip.room))), { disabled: !Menu.#clip.room }],
      '-',
      ['flag', 'Entry', () => App.edit(m => m.rooms.forEach(q => q.entry = q.id === id ? !r.entry : false)), { on: r.entry }],
      ['flag-checkered', 'Exit', () => room(x => x.exit = !x.exit), { on: r.exit }],
      ['star', 'Important', () => room(x => x.mark = x.mark === 'important' ? 'none' : 'important'), { on: r.mark === 'important' }],
      ['circle-check', 'Required', () => room(x => x.mark = x.mark === 'required' ? 'none' : 'required'), { on: r.mark === 'required' }],
      '-',
      ['bolt', 'Add event here', () => Inspector.addEvent(id)],
      ['eraser', 'Clear contents', () => room(x => { x.enemies = []; x.items = []; x.chests = []; x.builders = []; }),
        { disabled: !(r.enemies.length || r.items.length || r.chests.length || r.builders.length) }],
      ['trash', 'Delete room', () => Inspector.deleteSelected(id), { danger: true, key: 'Del' }],
    ];
  }

  static #passageItems(id) {
    const g = App.model.passages.find(q => q.id === id);
    const pass = fn => App.edit(m => fn(m.passages.find(q => q.id === id)));
    return [
      `Passage ${id}`,
      ['arrow-right', 'One-way', () => pass(x => x.dir = x.dir === 'a>b' ? 'both' : 'a>b'), { on: g.dir === 'a>b' }],
      ['right-left', 'Reverse', () => pass(x => [x.a, x.b] = [x.b, x.a])],
      '-',
      ['copy', 'Copy lock', () => Menu.#clip.lock = structuredClone(g.lock), { disabled: !g.lock.length }],
      ['paste', 'Paste lock', () => pass(x => x.lock = structuredClone(Menu.#clip.lock)), { disabled: !Menu.#clip.lock }],
      ['lock-open', 'Clear lock', () => pass(x => x.lock = []), { disabled: !g.lock.length }],
      '-',
      ['trash', 'Delete passage', () => Inspector.deleteSelected(id), { danger: true, key: 'Del' }],
    ];
  }

  static #canvasItems(at) {
    return [
      ['plus', 'Add room here', () => Inspector.addRoom(Graph.snap(at))],
      ['paste', 'Paste room here', () => Menu.#pasteRoom(Graph.snap(at), Menu.#clip.room), { disabled: !Menu.#clip.room }],
      '-',
      ['crosshairs', 'Fit view', () => Graph.fit()],
      ['sitemap', 'Re-layout', () => App.relayout()],
    ];
  }
  //#endregion

  static #settings(r) {
    return structuredClone(Object.fromEntries(Menu.ROOM_KEYS.map(k => [k, r[k]])));
  }

  static #pasteRoom(at, settings) {
    Inspector.addRoom(at, structuredClone(settings));
  }
}
