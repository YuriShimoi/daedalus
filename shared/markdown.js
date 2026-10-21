// Small Markdown renderer for note cards: headings, bold / italic / strike, inline code and fences,
// lists (with [ ] / [x] checkboxes), quotes, rules, links and images (`asset:<id>` resolves through
// `opts.asset`). Text is escaped first, so a note can't inject markup.
DAE_CORE(DAE => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  class Markdown {
    static esc = esc;

    static inline(s, opts = {}) {
      const codes = [];
      let out = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
      out = out
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${Markdown.#src(src, opts)}">`)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${/^(https?:|mailto:|#|\.)/.test(href) ? href : '#'}" target="_blank" rel="noopener">${t}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
        .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<i>$2</i>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>');
      return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
    }

    static #src(src, opts) {
      if(src.startsWith('asset:')) return opts.asset?.(src.slice(6)) ?? '';
      return /^(https?:|data:image\/)/.test(src) ? src : '';
    }

    /** Markdown text -> HTML. */
    static render(md, opts = {}) {
      const lines = String(md ?? '').replace(/\r/g, '').split('\n');
      const out = [];
      let list = null, para = [], i = 0;
      const flushPara = () => { if(para.length) out.push(`<p>${para.map(l => Markdown.inline(l, opts)).join('<br>')}</p>`); para = []; };
      const closeList = () => { if(list) out.push(`</${list}>`); list = null; };
      for(; i < lines.length; i++) {
        const line = lines[i];
        if(/^```/.test(line)) {
          flushPara(); closeList();
          const code = [];
          for(i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
          out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
          continue;
        }
        let m;
        if((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<h${m[1].length}>${Markdown.inline(m[2], opts)}</h${m[1].length}>`); }
        else if(/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); }
        else if((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<blockquote>${Markdown.inline(m[1], opts)}</blockquote>`); }
        else if((m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line))) {
          flushPara();
          const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
          if(list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
          const box = /^\[([ xX])\]\s+(.*)$/.exec(m[2]);
          out.push(box ? `<li class="task"><input type="checkbox" data-line="${i}"${box[1] !== ' ' ? ' checked' : ''}> ${Markdown.inline(box[2], opts)}</li>` : `<li>${Markdown.inline(m[2], opts)}</li>`);
        }
        else if(!line.trim()) { flushPara(); closeList(); }
        else { closeList(); para.push(line); }
      }
      flushPara(); closeList();
      return out.join('');
    }

    /** Flips the checkbox on a line ("- [ ]" <-> "- [x]"). */
    static toggleTask(md, line) {
      const lines = String(md).split('\n');
      lines[line] = lines[line].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
      return lines.join('\n');
    }

    /** Plain text lines (for SVG export): markers stripped, headings flagged. */
    static plain(md) {
      return String(md ?? '').replace(/\r/g, '').split('\n').filter(l => !/^```/.test(l)).map(l => {
        const h = /^(#{1,4})\s+(.*)$/.exec(l);
        const text = (h ? h[2] : l).replace(/^\s*[-*+]\s+\[([ xX])\]\s+/, (_, c) => (c === ' ' ? '☐ ' : '☑ ')).replace(/^\s*[-*+]\s+/, '• ')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|~~|`/g, '').replace(/(^|\W)[*_]([^*_]+)[*_]/g, '$1$2');
        return { text, head: h ? h[1].length : 0 };
      });
    }
  }

  DAE.Markdown = Markdown;
});
