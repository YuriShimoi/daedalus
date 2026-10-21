// Export the board (or the selection) as SVG, or PNG drawn from that SVG. Everything is drawn as SVG
// (notes as wrapped text, widgets as their current picture), so the PNG canvas is never tainted.
class Export {
  /** SVG markup of items (+ the links between them); widgets draw their current picture. */
  static build(items = App.selected.length ? App.selected : App.b.items) {
    return DAE.Draw.board(App.b, items, { widget: (it, w, h) => Widgets.get(it.id)?.exportSvg?.(w, h) ?? '' });
  }

  static #name(ext) {
    return App.fileName.replace(/(\.hestia)?\.toon$/, '') + (App.sel.size ? '-selection' : '') + '.' + ext;
  }

  static svg() {
    Files.download(Export.#name('svg'), new Blob([Export.build()], { type: 'image/svg+xml' }));
  }

  static async png(scale = 2) {
    const svg = Export.build(), m = /width="(\d+)" height="(\d+)"/.exec(svg);
    const W = Number(m[1]), H = Number(m[2]), k = Math.min(scale, 16000 / Math.max(W, H));
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('could not draw the board')); img.src = url; });
    const $c = document.createElement('canvas');
    $c.width = Math.round(W * k);
    $c.height = Math.round(H * k);
    $c.getContext('2d').drawImage(img, 0, 0, $c.width, $c.height);
    URL.revokeObjectURL(url);
    $c.toBlob(b => Files.download(Export.#name('png'), b), 'image/png');
  }
}
