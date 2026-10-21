# Ikaros · usage

Ikaros holds the small Daedalus tools, one per rail button. Open `ikaros/index.html` from disk (`file://`) or from any static host: no server, no build. A tool's files load the first time you open it; each one keeps its last work in the browser (IndexedDB), so it comes back when you return.

## Hub
- **Rail:** Home, then the eight tools. `Alt` + `1`–`8` switches tools, `Alt` + `0` goes Home. The address keeps the tool (`?tool=prisma`), so a bookmark opens it directly.
- **Home:** one card per tool (last used first) with its recent files; click a file to reopen it.
- **Drop** files anywhere: the open tool takes them. On Home, TOON / JSON go to Spyglass, images to Easel, CSS / HTML / SVG to Prisma.
- `Ctrl+O` opens a file in the current tool, `Ctrl+S` saves where a tool has a file (Spyglass).
- **From Hestia:** right-click a widget → *Open in Ikaros › Spyglass*, an image → *Open in Ikaros › Easel*, a note → *Find colors (Ikaros › Prisma)*.

## Spyglass: TOON / JSON viewer
Text on the left, the data as cards on the right (objects, arrays, and tables for lists of flat objects; strings green, numbers purple, booleans pink, null grey).
- Edits redraw the graph after a short pause. Errors show their line and column, and the old graph stays dimmed until the text parses again.
- **Click a card or a row:** its lines light up in the text and its **path** (`rooms[1].items[0]`) shows in the status bar (*copy*). Clicking in the text selects the matching card.
- **Collapse:** the chevron on a card (or its `+N` chip); *Collapse…* folds everything below a depth; *Expand* opens all. Files with more than 1500 cards start folded below depth 2.
- **Search** (`Ctrl+F`): keys and values; `Enter` / `Shift+Enter` jump between matches and unfold them.
- **Graph:** wheel zooms, drag pans, double-click a card row to jump to its child card, double-click the empty space to fit (`Shift+1`).
- **Right-click a card:** copy path, copy value as JSON or TOON, collapse, **Focus this branch** (shows only it; the chip at the top goes back).
- **Format** pretty-prints, **→ JSON / → TOON** converts the text. **Export:** PNG (2×), SVG, `.toon`, `.json`.
- TOON needs an object at the top: a JSON array or plain value cannot convert until it is wrapped in a key.

## Caliper: compare
Put the old version in **A** and the new one in **B** (open, paste, or drop two files at once). TOON and JSON can be mixed: Caliper compares the data, not the text.
- The tree shows every key with a badge: `+` added, `−` removed, `~` changed (`old → new`), `↕` moved (an array item found at another index). Both texts mark their changed lines.
- **Arrays by:** key (auto picks `id`, `name` or `key` when every item has a unique one), index, or a field you name.
- **Ignore** keys (e.g. `view, version`), **±** number tolerance, **Aa** ignores case, **any order** for lists of plain values; **changes only** hides the rest.
- `]` / `[` (or the arrows) jump between changes; the list on the right does too.
- **Export:** change list (Markdown / TOON), a JSON Patch (RFC 6902) that turns A into B. **Swap** exchanges A and B.

## Prisma: color extractor
- **Sources:** *Folder* reads every text file of a folder (skipping `node_modules`, `.git`, `dist`, `build`, minified files and files over 3 MB); *Files* adds files; drop files or a folder; or paste text on the left. Untick a file to leave it out. The file types read from folders are editable.
- **What counts:** any `#` hex (3, 4, 6 or 8 digits), `rgb()` / `rgba()`, `hsl()` / `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` (srgb, display-p3, xyz), and the 148 CSS color names, only where CSS reads them (stylesheets, `<style>`, `style=""`) or as a quoted value of a color-like key in code (`fillStyle = 'tomato'`). Bare hex without `#`, colors built with `var()` / `calc()`, link anchors (`href="#add"`) and id selectors (`#fff {`) are left out.
- **What it paints:** selector + property (`.btn:hover › background`), custom properties (`--accent`) and where `var(--accent)` is read, the element + attribute for HTML / SVG (`rect › fill`), or the key in code (`theme.warn`), with file, line and the source line.
- **Palette:** sort by hue, lightness, usage or first seen; group by file, what it paints (background, text, border, fill, shadow, variable) or variables; **Merge** joins colors closer than a ΔE (OKLab) into one swatch with its variants; filter by hex, name or file.
- **View:** *cards* (big swatches with hex, name and uses) or **compact** (every color side by side, no gaps).
- **Click a swatch:** hex / rgb / hsl / oklch to copy, contrast with white, black and the darkest color of the palette (AA / AAA), and every place it is used.
- **Export:** CSS variables, TOON, JSON, GIMP palette (`.gpl`), PNG swatch sheet, Markdown, and **compact PNG for 3D palettes**: every color as a block in one tight rectangle (1 px, 8 px, or 16 px per color in a power-of-two texture), in the current sort order.

## Easel: sprites, autotiles, test map
Tabs in the header: **Slice**, **Animate**, **Autotile**, **Map**. The sheet stays one image in memory; thumbnails and previews read it in place, pixels are only cut when exporting.
- **Slice:** *Grid* by cell size or rows × columns, with margin and spacing (empty cells skipped), or *Islands*: boxes around connected opaque pixels, parts closer than the merge gap stay together. Click a frame to select, `Shift` for a range, `Ctrl` to add; drag a frame to move it and its corner to resize; `Del` removes; `N` then drag draws a new frame; `Ctrl+A` selects all. Space or Alt + drag pans, wheel zooms.
- **Animate:** *New from selected frames*, then click frames on the sheet to add more. Name, FPS, mode (loop, ping-pong, once), per-frame time in ms under each frame of the timeline, pivot (click the preview). The preview plays at 1–8×, on checker / dark / light, with onion skin; `Space` plays / pauses.
- **Autotile** (ported from panda): a source of two tiles side by side (border, floor), one grid each, becomes the full 48-tile set (12 × 4) for every neighbor mix. *Border* cuts the floor back on bordered sides, *Corner* cuts its corners. Live preview plus a demo map. *Use as sheet* loads it for the Map; *Download PNG*; *Download mask table* lists each tile's neighbor mask (N 1, NE 2, E 4, SE 8, S 16, SW 32, W 64, NW 128).
- **Map:** a test map (up to 256 × 256) to check how tiles join. Layer **Terrain** paints with the autotile set: each cell picks its tile from its neighbors. Layer **Tiles** places any frame (pick it in the palette). Tools: brush (B), rectangle (R), fill (F), erase (E); right-click erases.
- **Open:** images (PNG, GIF, WebP, JPEG), Easel projects (`.easel.toon` / JSON), Aseprite JSON (hash or array), maps.
- **Export:** project TOON / JSON, Aseprite JSON, every frame as PNG (zip), repacked tight sheet + JSON (zip), GIF of the current animation, the map as TOON / JSON / PNG.

## Jigsaw: ciphers and codes
Two live texts: type in **Plain** to encode, in **Cipher** to decode. The **chain** on the left runs top to bottom when encoding and bottom to top when decoding; each step has its own key and options.
- **Substitution:** Caesar, ROT13, ROT47, ROT5, Atbash, Affine, keyword alphabet, custom alphabet, A1Z26.
- **Polyalphabetic:** Vigenère, Beaufort, Autokey, Gronsfeld, Porta, Running key.
- **Squares:** Polybius, Playfair, Bifid, ADFGX, ADFGVX, Four-square, Two-square, Nihilist.
- **Transposition:** Rail fence, Columnar, Double columnar, Scytale, Route (spiral / snake), Reverse.
- **Codes:** Morse, Tap code, Baconian, Keypad multi-tap, T9, NATO, Binary, Octal, Decimal bytes, Hex, Base32, Base64, Ascii85, URL, HTML entities, Unicode points, Elder Futhark runes, **Standard Galactic Alphabet**, Book cipher, XOR. Tidy steps: letters only, groups of N, uppercase.
- **Crack:** *Try all* ranks every keyless decoder, all Caesar shifts, rail fences and a Vigenère key guess by how much they read like the language (EN / PT); click one to use it. Letter frequency against the language (green marks), index of coincidence, likely Vigenère key lengths with a *key?* button.
- **Glyphs:** the plain text drawn as Pigpen, Templar, Braille, Semaphore, stick men (dancing-men style, a flag ends each word), Standard Galactic Alphabet, Mayan numbers or tally marks. Click the key to type letters (to decode a picture). SVG / PNG download for game assets.
- **Words:** anagrams (exact, two-word, longest words inside) from an English or Portuguese word list (loaded on first use), and a word search builder (size, directions) with answers and SVG export.

## Scale: dice
- Formula like `(3D6+1D12)*2+1D100`: `NdS` (N defaults to 1, `d%` = D100), `+ − * /` (division rounds down), parentheses. Per group: `kh3` / `kl1` keep highest / lowest, `dh1` / `dl1` drop, `!` explodes on the max, `r2` rerolls results up to 2 once. `adv` / `dis` = `2d20kh1` / `2d20kl1`.
- **Dice set:** only dice in the set are valid; add any from D4 to D100 (type `D7` + Enter), × removes, *reset* brings back D4 D6 D8 D10 D12 D20 D100. Click a die to roll it, Shift+click adds it to the formula.
- **Result:** the total, the formula with the values in, and every die (max green, 1 red, dropped faded, explosions outlined, rerolls show the first value).
- **Odds:** exact distribution when it stays small (else 20,000 sample rolls), min / mean / max, and the chance of ≥ / ≤ a value.
- **History:** every roll (pin, roll again, copy, filter), CSV download. **Saved** formulas roll with one click. `Enter` / `Space` rolls.

## Wheel
- **Items:** on / off, color, label, icon, odds % (other items share what is left; 🔒 keeps an item's %), remove. *even* gives everyone the same odds; *text* edits the list as `label | weight | #color` lines.
- **Slices:** *by odds* (size follows the odds) or *equal* (all the same size, odds hidden). Color palettes, pointer on top or right, spin time.
- **Spin:** click the wheel, the SPIN hub, the header button, `Space` / `Enter`, or flick the wheel (a faster flick spins longer). The winner is picked first by its odds and the wheel lands inside its slice with an ease-out curve; ticks play at each slice edge. **Elimination** turns the winner off for the next spin.
- **Results:** counts against the odds, the last spins, CSV. **Saved wheels** keep several setups. Export TOON / JSON / PNG.

## Metronome: easing and animations
- **Curves:** the CSS keywords, the easings.net set (Sine … Bounce, in / out / in-out), springs and steps. Drag the two handles to shape a cubic-bezier (above or below the box overshoots), or type any CSS timing function (`cubic-bezier()`, `steps()`, `linear()`). Springs take stiffness, damping and mass; steps take a count and the jump mode. The preview moves, scales, turns, fades and fills with the curve; *Race it* adds the curve to a race of up to 4.
- **Animations:** Font Awesome's (beat, bounce, fade, beat-fade, flip, shake, spin, spin-pulse, spin-reverse, same variables as `--ik-*`), attention (pulse, heartbeat, wobble, swing, tada, jello, rubber-band, blink, pop), float, and enter / exit (fade, slide, zoom). Change duration, timing, repeat, direction and each variable; pick an icon to see it on (a circle by default), size and color.
- **Copy as:** CSS (`cubic-bezier()` / `linear()`, or `@keyframes` + a class with the variables), JS (`ease(t)` function or `element.animate()`), TOON, sample values.

## CLI
`tools/bin/ikaros.cmd` (or `node ikaros/cli.js`), run `ikaros` alone for the list:
```
ikaros spyglass convert map.toon -o map.json          ikaros spyglass paths map.toon --find key
ikaros caliper v1.toon v2.json --ignore view --patch  (exit code 1 when they differ)
ikaros prisma ./src --merge 2 -o palette.css          ikaros prisma site.css --refs
ikaros jigsaw encode vigenere "attack at dawn" --key LEMON
ikaros jigsaw chain "vigenere:key=KEY,base64" encode "secret"
ikaros jigsaw try "Wkh vhfuhw..."                     ikaros jigsaw anagram listen --lang pt
ikaros scale "(3D6+1D12)*2+1D100" -n 5 --odds         ikaros wheel spin loot.wheel.toon -n 1000
```
Easel and Metronome have no CLI (they need images or a screen).
