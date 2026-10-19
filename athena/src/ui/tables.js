// Editable card lists and form rows. Values are edited as text in the TOON cell syntax
// (lists "a+b", conditions "key:red+kill:ogre", actions "unlock:p1+fx+:rage@player").
class Tables {
  static esc(v) {
    return String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  /** Input markup for one field. f: { type, options, value, key, bad, cls } */
  static input(f) {
    const data = `data-f="${Tables.esc(f.key)}"`;
    const c = [f.cls, f.bad && 'bad'].filter(Boolean).join(' ');
    const cls = c ? ` class="${c}"` : '';
    if(f.type === 'bool') return `<input type="checkbox" ${data} ${f.value ? 'checked' : ''}>`;
    if(f.type === 'select')
      return `<select ${data}${cls}>${f.options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o === '' ? '—' : o];   // [value, label] pairs or plain values
        return `<option value="${Tables.esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${Tables.esc(l)}</option>`;
      }).join('')}</select>`;
    return `<input ${f.type === 'num' ? 'type="number" step="any"' : 'type="text"'} ${data}${cls} value="${Tables.esc(f.value)}" spellcheck="false"${f.placeholder ? ` placeholder="${Tables.esc(f.placeholder)}"` : ''}>`;
  }

  static #read($i) {
    return $i.type === 'checkbox' ? $i.checked : $i.value;
  }

  /**
   * Card list: one card per row, the ID as the card title and the other columns as small labeled fields.
   * cols: [{ key, label, type (text|num|bool|select|chips), options (list, [value, label] pairs or fn(row)), label (text or fn(row)), show(row), get(row), set, wide, title }] ; onEdit(i, key, raw) on change; onDelete(i).
   * `bad` holds row ids to flag; `ns` keeps field keys unique when a pane has several lists; icon(row) adds markup before the title.
   */
  static #open = new Set();   // expanded cards of collapsible lists: "ns:index"

  /** Opens a collapsible card (from a field key "ns:index:field"), e.g. one just added. */
  static expand(key) {
    Tables.#open.add(key.split(':').slice(0, 2).join(':'));
  }

  static table($el, { rows, cols, onEdit, onDelete, bad = new Set(), ns = 't', index = (r, i) => i, icon = null, collapse = false }) {
    if(!rows.length) {
      $el.innerHTML = '<div class="empty">None yet. Use + to add one.</div>';
      return;
    }
    const head = cols.find(c => c.key === 'id');
    const byIdx = new Map(rows.map((r, i) => [index(r, i), r]));
    const field = (r, i, c) => {
      if(c.show && !c.show(r)) return '';
      if(typeof c.label === 'function') c = { ...c, label: c.label(r) };
      if(c.type === 'chips') return Tables.#chips(`${ns}:${index(r, i)}:${c.key}`, c, c.get ? c.get(r) : r[c.key]);
      const options = typeof c.options === 'function' ? c.options(r) : c.options;
      const inp = Tables.input({ ...c, options, key: `${ns}:${index(r, i)}:${c.key}`, value: c.get ? c.get(r) : r[c.key] });
      return c.type === 'bool'
        ? `<label class="fld bool" title="${Tables.esc(c.title ?? '')}">${inp}<span>${c.label}</span></label>`
        : `<label class="fld${c.wide ? ' wide' : ''}" title="${Tables.esc(c.title ?? '')}"><span>${c.label}</span>${inp}</label>`;
    };
    const folded = i => collapse && !Tables.#open.has(`${ns}:${i}`);
    $el.innerHTML = `<div class="cards">${rows.map((r, i) => `<div class="card${bad.has(r.id) ? ' bad' : ''}${folded(index(r, i)) ? ' folded' : ''}" data-i="${index(r, i)}">
        <div class="card-head">${collapse ? `<button class="fold" data-fold="${index(r, i)}" title="Show / hide the fields">${DAE.Icons.html('chevron-down')}</button>` : ''}${icon?.(r) ?? ''}${head ? Tables.input({ ...head, cls: 'title', key: `${ns}:${index(r, i)}:id`, value: r.id }) : `<b class="title">#${i + 1}</b>`}
          <button class="del" data-del="${index(r, i)}" title="Delete">${DAE.Icons.html('trash')}</button></div>
        <div class="card-grid">${cols.filter(c => c !== head).map(c => field(r, i, c)).join('')}</div>
      </div>`).join('')}</div>`;
    const parse = f => f.match(/^[^:]*:([^:]*):(.*)$/).slice(1);
    const list = (i, key) => { const c = cols.find(q => q.key === key), r = byIdx.get(+i); return [...(c.get ? c.get(r) : r[key])]; };
    $el.querySelectorAll('[data-f]').forEach($i => {
      $i.onchange = () => {
        const [i, key] = parse($i.dataset.f);
        // chips: the select appends its pick to the list
        if('add' in $i.dataset) return $i.value && onEdit(+i, key, [...list(i, key), $i.value]);
        onEdit(+i, key, Tables.#read($i));
      };
    });
    $el.querySelectorAll('[data-rm]').forEach($b => {
      $b.onclick = e => {
        e.preventDefault();
        const [i, key] = parse($b.closest('[data-chips]').dataset.chips);
        onEdit(+i, key, list(i, key).filter((_, k) => k !== +$b.dataset.rm));
      };
    });
    $el.querySelectorAll('[data-del]').forEach($b => { $b.onclick = () => onDelete(+$b.dataset.del); });
    $el.querySelectorAll('[data-fold]').forEach($b => {
      $b.onclick = () => {
        const k = `${ns}:${$b.dataset.fold}`;
        const open = !Tables.#open.has(k);
        open ? Tables.#open.add(k) : Tables.#open.delete(k);
        $b.closest('.card').classList.toggle('folded', !open);
      };
    });
  }

  /** List field: one chip per entry (icon + name + remove) and a select that adds one. c: { label, options, icon(id) } */
  static #chips(key, c, values) {
    const chips = values.map((v, k) => `<span class="chip-item">${c.icon?.(v) ?? ''}${Tables.esc(v)}<button data-rm="${k}" title="Remove">${DAE.Icons.html('xmark')}</button></span>`).join('');
    const add = `<select data-f="${Tables.esc(key)}" data-add><option value="">+ add…</option>${c.options.map(o => `<option value="${Tables.esc(o)}">${Tables.esc(o)}</option>`).join('')}</select>`;
    return `<div class="fld wide"><span>${c.label}</span><div class="chips" data-chips="${Tables.esc(key)}">${chips}${add}</div></div>`;
  }

  /** Label + input rows. fields: [{ key, label, type, value, options }] ; onEdit(key, raw) */
  static form($el, fields, onEdit) {
    $el.innerHTML = fields.map(f => f.type === 'checks'
      ? `<div class="row"><label>${f.label}</label><div class="checks">${f.items.map(c => `<label>${Tables.input({ ...c, type: 'bool' })} ${c.label}</label>`).join('')}</div></div>`
      : `<div class="row"><label for="f-${f.key}" title="${Tables.esc(f.title ?? '')}">${f.label}</label>${Tables.input(f).replace('data-f', `id="f-${f.key}" data-f`)}</div>`).join('');
    $el.querySelectorAll('[data-f]').forEach($i => { $i.onchange = () => onEdit($i.dataset.f, Tables.#read($i)); });
  }

  /** Icon for an item: a key in its key color for key items, else `fallback` (or nothing). */
  static itemIcon(id, fallback = null) {
    const k = App.model.items.find(t => t.id === id)?.key;
    if(k) return DAE.Icons.html('key').replace('<svg', `<svg style="color:${DAE.Svg.keyColor(k)}"`);
    return fallback ? DAE.Icons.html(fallback) : '';
  }

  //#region [ Cell parsing ]
  static list(v) {
    return String(v ?? '').split('+').map(x => x.trim()).filter(Boolean);
  }

  static num(v, empty = 0) {
    return v === '' || v === null || v === undefined ? empty : Number(v);
  }

  static conds(v) {
    return Tables.list(v).map(DAE.Model.parseCond);
  }

  static condStr(list) {
    return list.map(DAE.Model.condStr).join('+');
  }
  //#endregion
}
