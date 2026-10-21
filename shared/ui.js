// Page helpers shared by the tools: range sliders fill up to their thumb (the style is in base.css;
// --p, 0..1, follows the value on input and whenever a slider is added or set by a render).
(DAE => {
  class UI {
    /** Sets --p of a range input from its value. */
    static fill($i) {
      const min = $i.min === '' ? 0 : Number($i.min), max = $i.max === '' ? 100 : Number($i.max);
      $i.style.setProperty('--p', max > min ? (Number($i.value) - min) / (max - min) : 0);
    }

    /** Keeps every range input of the page filled (call once). */
    static ranges() {
      if(UI.#ranges) return;
      UI.#ranges = true;
      addEventListener('input', e => { if(e.target.type === 'range') UI.fill(e.target); }, true);
      new MutationObserver(() => document.querySelectorAll('input[type=range]').forEach(UI.fill))
        .observe(document.body, { childList: true, subtree: true });
      document.querySelectorAll('input[type=range]').forEach(UI.fill);
    }

    static #ranges = false;
  }

  DAE.UI = UI;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
