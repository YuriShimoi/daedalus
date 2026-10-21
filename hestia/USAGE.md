# Hestia · usage

Hestia is the Daedalus board: one infinite canvas to draw on, keep Markdown notes and image references linked together, and run live mini versions of the other tools as widgets. Open `hestia/index.html` from disk (`file://`) or from any static host. It needs no server and no build step. A demo board is in `samples/demo.hestia.toon` (Open board, or drop it on the board).

## Board
- **Pan:** wheel, Space + drag, middle-drag or the hand tool (H). **Zoom:** Ctrl + wheel (or pinch), the zoom box at the bottom left; Shift+1 fits everything, Shift+2 fits the selection, Ctrl+0 is 100%.
- **Select:** click, Shift+click to add, drag on the empty board for a box. Drag to move: it snaps to other items' edges and centers (pink guide) or to the dot grid; hold **Alt** to move freely. Resizing snaps the dragged edges the same way. Moving a group moves its members; handles to resize (images and text keep their ratio; Shift frees it), arrow keys nudge (Shift = 10).
- **Context bar** (under the header): color, border (an outline for cards, images and widgets, a casing around shapes and pen strokes; on text it is the **underline** color; lines and arrows have none; new items (except pen strokes and text) get the near-black border, or whatever border you picked last; the crossed swatch removes it), fill, width and text size for the selection or the active tool, plus front / back, duplicate, lock and delete.

## Tools
| Key | Tool | Use |
|---|---|---|
| V | Select | see above; double-click a text, note or shape to edit its text, an empty spot to write |
| H | Hand | pan |
| P | Pen | freehand strokes (the tool stays on; strokes start without a border) |
| R | Shape | pick the shape in the bar above: rectangle, ellipse, diamond, triangle, hexagon, parallelogram, star, cylinder, speech bubble (O / D jump to ellipse / diamond); drag to draw (Shift: square), click for a default size; shapes take a label, and the picker also changes selected shapes |
| L / A | Line, arrow | drag; an end dropped on an item sticks to it and follows it (hold **Alt** to leave it free). Drag the middle handle to bend it; the bar's **Path** switches between a sharp corner and a curve, *straight* (or double-clicking the handle) removes the bend |
| T | Text | click and type; Esc or a click outside ends it |
| N | Note | Markdown card: headings, **bold**, *italic*, `code`, lists, `- [ ]` checkboxes (click to tick), links, quotes, code blocks |
| I | Image | pick an image; or paste (Ctrl+V) or drop one |
| W | Widget | pick an Athena map, an Apollo `.toon` or an audio file |

**Groups:** select items and right-click → *Group selection* (Ctrl+G; Ctrl+Shift+G or *Ungroup* removes the frame). A group's frame sizes itself around its members; drop an item inside a frame to add it, drag it out to take it out (a group left empty goes away). Double-click the label to rename.

**Links between items (Obsidian canvas):** select an item and drag one of its four side dots onto another item. Dropping on an empty spot makes a new linked note. Double-click a link to give it a label; click it to select (color, delete).

## Widgets
Widgets are windows on the board: drag the title bar to move, the corner grip (or the selection handles) to resize. A new player window takes the height of its content. Right-click a widget for **Open in Athena / Apollo (new tab)**, Replace file, Save file and the widget's own options. Dropping a `.toon` or an audio file on the board makes the right widget.
- **Athena map:** every room, passage, lock, item and icon at its saved position. The step bar replays the map's route: ◀ previous, the current step (`2/16 · take sword`), next ▶, and a route picker when the map has more than one. Wheel zooms and drag pans inside the window; the fit button (or a double-click on the map) shows every room again. A map without a route shows its start.
- **Apollo player:** play / pause, a waveform seek bar, time, loop and volume.
  - Audio files: `.wav`, `.mp3`, `.ogg`, `.m4a`, `.mp4` (its audio), `.flac`, `.webm`.
  - Apollo songs are rendered on your machine and encoded to **Opus (Ogg, 128 kb/s)**, about 1/10 of a WAV, and kept in the board so they render once (again only when the song changes). With the song's loop on, the loop range is rendered as a seamless loop. Browsers without Opus encoding keep a WAV instead.
  - Apollo SFX projects list their sounds and mixes; click one to play it.

## Files
- **Save / Open** (Ctrl+S / Ctrl+O): one `.hestia.toon` file holds everything, images and widget files included. Ctrl+Shift+S saves as.
- The board is autosaved in the browser and comes back on the next visit; the empty board lists recent boards.
- **Export:** PNG or SVG of the board, or of the selection when there is one (widgets export as their current picture). The menu also saves the board as JSON.
- **Copy / paste:** Ctrl+C / Ctrl+X / Ctrl+V inside the board (links between copied items come along); pasted text becomes a note, pasted images become image items. Ctrl+D duplicates.
- Search with Ctrl+F (notes, text, labels, link labels); Enter jumps to the next hit.

## Obsidian
- **Open** a `.canvas` (Open board): it becomes a new board. **Drop** a `.canvas` on the board, together with the files it uses (notes, images, maps), to add it there; file nodes whose file wasn't dropped become placeholder notes.
- Conversion: text cards → notes; links → notes with the link; groups → groups (members are the cards inside); edges → links (label and color kept); file cards → images, notes (`.md`, with its Markdown), Athena map / Apollo widgets (`.toon`, audio) or a placeholder. Obsidian's 6 preset colors map to the Dracula ones. In Markdown, `![[image]]` embeds the image, `[[note|alias]]` becomes bold text and front matter is dropped.
- A whole vault and the reverse (board → `.canvas`) are in the CLI below.

## CLI
`tools\bin\hestia.cmd` (or `node hestia/cli.js`); same core as the page, so its boards open there unchanged. `hestia help` lists everything.
```
hestia new -o board.toon
hestia import Plan.canvas -o board.toon             Obsidian canvas (file nodes read from its vault: the folder with .obsidian)
hestia import "D:/notes/MyVault" -o vault.toon      whole vault: a note card per .md, a group per folder, [[wikilinks]] as links
hestia export board.toon --to canvas -o Plan.canvas  back to Obsidian; images and widget files go to Plan-files/
hestia add board.toon map.toon song.toon pic.png note.md other.canvas [--at x,y]
hestia edit board.toon "<op>" "<op>" ...
hestia info board.toon | hestia list board.toon     overview / one line per item (ids for edit ops)
hestia render board.toon -o board.svg [--ids 1,2]   picture (Athena maps drawn in their widgets)
hestia convert board.toon --to json -o board.json
```
**Edit ops** (new items without `x= y=` go to the right of the board; colors: white gray pink purple cyan green yellow orange red dark none or `#hex`; `
` in quotes is a new line):
| op | example |
|---|---|
| note | `note add '# Boss room
- [ ] theme' x=0 y=0 color=pink` |
| text | `text add 'Act 1' x=0 y=-60 size=32 color=cyan` |
| shape | `shape add star x=320 y=0 text=key color=yellow fill=tint` (rect ellipse diamond triangle hexagon parallelogram star cylinder bubble) |
| arrow / line | `arrow add from=1 to=2` (ids attach; `x,y` is a free end), `mid=250,-60 curve=true` bends it |
| link | `link 1 2 label=needs color=green`, `unlink 1 2` |
| group | `group 1,2,3 label=Keep color=green`, `ungroup 6` |
| set | `set 2 border=orange fill=solid`, `set 1 md='# New'`, `set 4 mid=none`, `set 3 x=100 y=40` |
| move / remove | `move 1,2 40 0`, `remove 5` |
| view | `view fit`, `view x=0 y=0 zoom=0.8` |

## Tests
`npm test` (repo root) runs the board, Markdown, Ogg Opus writer, Obsidian converter and CLI tests in `hestia/tests/`.
