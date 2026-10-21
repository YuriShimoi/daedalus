// Right-click menu shared by the tools (style: .ctx in base.css). Rows:
//   '-'                                  separator
//   'Title'                              small header
//   [icon, label, fn, { key, on, danger, disabled }]
// It closes on a click outside, Escape, window blur / resize, or after a row runs.
(DAE => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  class Menu {
    static #$el = null;

    static show(x, y, rows) {
      Menu.close();
      Menu.#init();
      const $m = Menu.#$el = document.createElement('div');
      $m.className = 'ctx';
      let prevSep = true;
      rows.forEach((r, i) => {
        if(!r) return;
        if(r === '-') {
          if(!prevSep && i < rows.length - 1) $m.insertAdjacentHTML('beforeend', '<hr>');
          prevSep = true;
          return;
        }
        prevSep = false;
        if(typeof r === 'string') { $m.insertAdjacentHTML('beforeend', `<h4>${esc(r)}</h4>`); return; }
        const [icon, label, fn, o = {}] = r, $b = document.createElement('button');
        $b.className = [o.on && 'on', o.danger && 'danger'].filter(Boolean).join(' ');
        $b.disabled = !!o.disabled;
        $b.innerHTML = `${icon && DAE.Icons ? DAE.Icons.html(icon) : '<i></i>'}<span>${esc(label)}</span>${o.key ? `<kbd>${esc(o.key)}</kbd>` : ''}`;
        $b.onclick = () => { Menu.close(); fn(); };
        $m.append($b);
      });
      $m.lastElementChild?.tagName === 'HR' && $m.lastElementChild.remove();
      document.body.append($m);
      // keep it inside the window
      const b = $m.getBoundingClientRect();
      $m.style.left = Math.max(4, Math.min(x, innerWidth - b.width - 4)) + 'px';
      $m.style.top = Math.max(4, Math.min(y, innerHeight - b.height - 4)) + 'px';
    }

    static get open() {
      return !!Menu.#$el;
    }

    static close() {
      Menu.#$el?.remove();
      Menu.#$el = null;
    }

    static #ready = false;
    static #init() {
      if(Menu.#ready) return;
      Menu.#ready = true;
      document.addEventListener('pointerdown', e => { if(!e.target.closest?.('.ctx')) Menu.close(); }, true);
      document.addEventListener('keydown', e => { if(e.key === 'Escape') Menu.close(); });
      addEventListener('blur', Menu.close);
      addEventListener('resize', Menu.close);
    }
  }

  DAE.Menu = Menu;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
