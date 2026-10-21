// Right-click menu (item, widget, edge, empty board) and the export menu.
class Menu {
  static open(cx, cy, ctx) {
    const it = ctx.item, I = DAE.Icons.html, rows = [];
    if(ctx.edge) {
      rows.push(['Edit label', 'font', () => Tools.editEdge(ctx.edge)], ['Delete link', 'trash', () => App.remove(), 'Del']);
    }
    else if(it) {
      if(it.kind === 'widget') {
        rows.push(...Widgets.menu(it), null);
      }
      if(['text', 'note'].includes(it.kind) || (it.kind === 'shape' && !Board.isLine(it))) rows.push(['Edit text', 'font', () => Tools.edit(it), 'Dbl-click']);
      if(it.kind === 'group') rows.push(['Rename group', 'font', () => Tools.editGroup(it)], ['Ungroup', 'object-group', () => Panels.act('ungroup')]);
      if(App.selected.some(x => x.kind !== 'group')) rows.push([App.sel.size > 1 ? 'Group selection' : 'Make a group', 'object-group', () => Panels.act('group'), 'Ctrl+G']);
      if(it.kind === 'image') rows.push(['Save image', 'download', () => Files.saveAsset(it.asset)]);
      rows.push(['Copy', 'copy', () => App.copy(), 'Ctrl+C'], ['Duplicate', 'clone', () => App.duplicate(), 'Ctrl+D'], null,
        ['Bring to front', 'layer-group', () => Panels.act('front'), 'Ctrl+]'], ['Send to back', 'layer-group', () => Panels.act('back'), 'Ctrl+['],
        it.locked ? ['Unlock', 'lock-open', () => Panels.act('unlock')] : ['Lock', 'lock', () => Panels.act('lock')], null,
        ['Delete', 'trash', () => App.remove(), 'Del', it.locked]);
    }
    else {
      rows.push(['Paste here', 'paste', () => App.paste(ctx.at), 'Ctrl+V', !App.clip], null,
        ['Note here', 'note-sticky', () => Tools.newNote(ctx.at), 'N'], ['Text here', 'font', () => Tools.newText(ctx.at), 'T'],
        ['Image here…', 'image', () => Files.pick('image', ctx.at), 'I'], ['Widget here…', 'window-maximize', () => Files.pick('widget', ctx.at), 'W'], null,
        ['Select all', 'object-group', () => App.select(App.b.items.map(i => i.id)), 'Ctrl+A'], ['Zoom to fit', 'expand', () => App.fit(), 'Shift+1']);
    }
    Menu.#show(cx, cy, rows);
  }

  static exportMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), part = App.sel.size ? 'selection' : 'board';
    Menu.#show(r.left, r.bottom + 4, [
      [`PNG (${part})`, 'image', () => Export.png()], [`SVG (${part})`, 'file-export', () => Export.svg()], null,
      ['Board as JSON', 'file-export', () => Files.saveJson()],
    ]);
  }

  /** Shows rows in the shared menu (shared/menu.js); null rows are separators. */
  static #show(cx, cy, rows) {
    DAE.Menu.show(cx, cy, rows.map(r => (r ? [r[1], r[0], r[2], { key: r[3], disabled: !!r[4] }] : '-')));
  }

  static close() {
    DAE.Menu.close();
  }
}
