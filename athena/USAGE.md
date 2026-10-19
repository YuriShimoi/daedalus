# Athena · usage

Athena is the room explorer in Daedalus. It generates, edits, solves and plays room graphs. Open `athena/index.html` from disk (`file://`) or from any static host. It needs no server and no build step.

## Page
- **Top bar:**
  - New, Open, Save, Save as (`.toon`; `.json` opens too).
  - Generate.
  - Quick check, Solve, Play.
  - Undo and redo (Ctrl+Z / Ctrl+Y). Ctrl+S saves.
- **Graph:**
  - Double-click empty space to add a room.
  - Drag from one room to another to add a passage. Click to select. Del deletes.
  - Wheel zooms, dragging the background pans, and the corner buttons fit or re-lay out the map.
  - Room markers: the entry has a green ring and exits a red one. A yellow dashed ring means `required`, a star means `important` and a bolt means the room has events.
  - Badges under a room count enemies (and their waves), items, chests and builders.
  - Locks show the key color. Kill locks are dashed. One-way passages have arrows.
- **Right panel:**
  - Room/Passage, Player, Items (and chests), Enemies, Effects, Recipes, Events, Rules & Score (validation is listed there too).
  - Cells use the TOON cell syntax: lists `a+b`, conditions `key:red+kill:ogre+stat:str=5`, actions `unlock:p1+fx+:rage@player+spawn:rat@r2:2`.
- **Dock:**
  - Quick check gives one of four results: no path, locks (blockers are flagged in red), solvable without enemies (its route is added), or needs combat.
  - Solve runs in a Web Worker. You choose top 1 or top 3 and the score mode, see live progress, and can stop it at any time.
  - Pick a route to play it back with the slider and the stats card. The floppy icon saves it into the map's `solutions`.
- **Play mode:**
  - The legal actions show as buttons. Click a linked room to move there.
  - Before each wave the fight pauses for prep (use items, equip).
  - Back undoes a step. "Save as route" stores the run. Esc leaves play mode.

## Rules in short
- Entering a room with live enemies starts the fight.
  - Waves fight in order. Every enemy in a wave fights at once.
  - The player hits first and targets the first enemy that isn't invulnerable.
  - Damage is `max(1, STR-DEF)`, or 0 against an invulnerable target.
- **Durability:** each room fight costs 1 use on equipped gear.
- **Effects:**
  - Each effect is a flat change to max HP, STR or DEF.
  - Duration is `perm`, `N` room fights, or `equip`.
  - Items add effects (`addFx`) or remove them (`delFx`) on `self`, `one` enemy or `all` enemies, and equipped items apply `onHit` effects to the enemy they hit.
- **Events:**
  - An event fires on `enter` or `leave`, can be limited with `once`, and can have an `if` (lock conditions).
  - Actions: lock, unlock, give, take, fx+, fx-, spawn, kill.
  - Targets: `player`, an enemy type, or an instance such as `r2.1`.
- **Keys and chests:**
  - Keys spend 1 use per lock (`inf` never runs out), and an opened lock stays open.
  - Opening a chest puts its items on the floor.
- **Inventory:**
  - On (the default): items go to a bag and are equipped into slots.
  - Off: items live in slots only, and `free` slots act like `hold-drop`.
- **Exits:** reaching an exit, after every `required` room has been visited, ends the route.

## CLI
`athena` (after `npm link` in the repo root), or `node athena/cli.js`:
```
athena gen      --seed 7 --rooms 40 --branching 0.4 --deepnest 3 [--solve] -o map.toon
athena check    map.toon [--json]
athena solve    map.toon --top 3 --mode weighted [--time 10000 --visits 4] [-o map.toon] [--json]
athena validate map.toon [--json]
athena play     map.toon --steps "take sword;equip sword;move r1;fight" [--at 2] [--save [id] -o map.toon]
athena render   map.toon -o map.svg [--route 1 | --steps "..."]
athena layout   map.toon [--all] -o map.toon
athena edit     map.toon "add rooms r9 weight=2" "link r3 r9 dir=a>b lock=key:red" "set items potion heal=12" -o map.toon
athena convert  map.toon --to json|toon [-o out]
```
- `play --at N` prints the state after step N (0 = start), like the playback slider. `--save` adds the steps as a solution (to `-o`, or back into the map file).
- `layout` writes room `x,y` from the automatic layout for rooms without a position (`--all`: every room). `render` uses saved positions.
- `edit` ops, one per argument: `add <table> <id> [field=value…]`, `set <table> <id|index> field=value…`, `remove <table> <id|index>`, `link <a> <b> [field=value…]`. Tables: rooms, items, enemies, effects, chests, passages, recipes (by index, no id), events, solutions, slots; `set player|rules|score field=value` takes no id. Cells use the file syntax (`ogre:2+rat`, `key:red`); `field=` clears a field. Removing a room removes its passages. The result is validated (errors on stderr) and written to `-o` or stdout.
Exit codes:
- `0`: ok or solved (for `check`: solvable without enemies)
- `2`: unsolvable
- `3`: needs combat (`check` only)
- `1`: error or invalid map

Action strings: `move r1`, `take x`, `take x>slot`, `drop x`, `equip x`, `unequip slot`, `use x`, `use x>r2.1`, `open c0`, `craft out/<recipe index>`, `fight`.

## Tests
- `npm test` runs the Node suites: TOON, model, validator, quick check, rules (about 60 scenarios), solver, generator (200 seeds × 3 sizes), layout/SVG and CLI.
- `athena/tests/selftest.html` checks in a browser that the solver's Blob worker starts, on both `file://` and http.
