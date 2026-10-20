# Apollo · usage

Apollo is the music and sound effects tool in Daedalus. Open `apollo/index.html` from disk (`file://`) or from any static host. It needs no server and no build step. Audio starts on your first click (browser rule).

## Start
- Pick **Music maker** or **SFX maker**, open a `.toon` project, or click a recent project.
- The recent list keeps the last 6 saved projects plus the autosave, so they reopen without a file picker.
- The Apollo button in the header goes back to this screen. Music / SFX in the header switches the view of the same project.
- **Simple / Full** (per mode, saved in the project): Simple hides the less important controls. Nothing is lost, and sounds play the same.

## Music maker
- **Playlist:** tracks × bars.
  - Click an empty cell to place the selected pattern; drag to paint along the row (a pattern longer than one bar is placed once per its length); right-click (or right-drag) clears; clicking a clip selects its pattern.
  - Bar ruler: click sets the start bar (or seeks while playing); drag sets the loop range. Loop toggles in the header.
  - Track strip: M mutes. Full adds solo, volume, move up and delete. Double-click a name to rename it. Up to 8 tracks.
- **Piano roll** (melodic tracks):
  - Click adds a note (length = the last one used); drag moves; drag the right edge resizes; right-click deletes.
  - Shift-drag box-selects. Ctrl+A, Ctrl+C / Ctrl+V (paste goes right after the selection), Del, ↑ / ↓ transpose (Shift: octave).
  - Keys outside the song's scale are dimmed. Click a key on the left to hear it. Full adds the velocity lane (drag over notes).
- **Channel rack** (drum tracks): click toggles a step, shift-click places an accent, drag paints. Click a row name to hear it.
- **Patterns:** the numbered buttons pick one; + makes a new one. The length picker sets 1-8 bars (the piano roll gets one screen width per bar and scrolls sideways) and the trash button deletes the pattern and its clips. Full adds duplicate, transpose and clear.
- **Instrument panel:**
  - Engines: chip, pluck (Karplus-Strong guitars, bass, harp), fm keys, organ, sample (FluidR3 piano, guitar, e-piano).
  - Presets per engine. Full adds the envelope, tone sliders, pan, track volume, and preset Load / Save `.toon`.
  - Drum tracks: synth 808 kit or the sampled VCSL kit, volume per row (Full: tune and decay).

## SFX maker
- **Generate:** each button makes a new seeded sound (pickup, laser, explosion, powerup, hit, jump, blip, click, synth, tone, footstep, random; Full adds menu, error, zap, teleport, thud).
- **Random** makes a new random sound; **Mutate** nudges the current one. Locked params (Full) are kept by both.
- Waves: Simple shows 5 (square, saw, sine, triangle, noise); Full adds pink, 1-bit, breaker, tan, whistle, buzz.
- Sliders: Simple shows attack, sustain, decay, base freq, slide, low-pass; Full shows every param, each with a lock.
- Click the waveform or the play button to listen. Full shows length, samples, size, peak, clipped count.
- **Sounds:** click to select and play, double-click to rename, delete. Full adds duplicate.
- **Mixer** (Full): "New mix from this sound", then up to 5 layers, each with a delay (ms) and volume (%). A mix is a sound of its own.
- **Sets** (Full): "Variants" makes 6 mutations of the current sound into a set. Add or remove items, play a random one, export the set.
- **Export** (Full): rate 44k / 22k / 11k / 8k, 16 or 8 bit, normalize. "Whole set" / "All sounds" write one WAV each (into a folder when the browser allows). The copy / paste icons move params as an `apollo-sfx:` text code.

## Keyboard (both modes)
- Physical keys play the selected track (music) or the current sound, pitched (sfx). Drum tracks: the first key plays the first row, and so on.
- **FL style** (default): Z S X D C … for the lower octave, Q 2 W 3 E … for the upper one; `-` / `=` shift octaves. **One row**: A W S E D F T G … with Z / X for octaves.
- **Rec** (music): while the song plays, what you play is written into the selected pattern.
- Full:
  - **Learn**: click a key on screen, then press the physical key to bind. Esc cancels. Bindings use the key position, so they work on any layout (labels show your layout's characters when the browser tells).
  - Key panel: the note, a cents offset (−100…+100) or an absolute Hz value per key. Equal resets every key; Just tunes every key to just intonation on the song key; Reset clears the selected key.
  - Save / Load templates as `.toon`; saved templates also appear in the template list.

## Files
- Ctrl+S saves the project (`.toon`; Shift: save as), Ctrl+O opens, Ctrl+Z / Ctrl+Y undo / redo, Space plays / stops.
- **WAV** (header): music exports the loop range as a seamless loop when Loop is on (release tails wrap onto the start), else the whole song (44.1 kHz, 16-bit, stereo). SFX exports the current sound with the export settings.
- Autosave keeps the open project in `localStorage` (convenience only; save to a file to keep it).

## CLI
Same core and sample packs as the page (`toolsinpollo.cmd`, or `node apollo/cli.js`). Everything the page makes can be made here; `apollo help` lists every command and op.
```
apollo new --bpm 140 --key A --bars 8 -o song.toon      starter project (--empty: one blank track, --mode sfx)
apollo edit song.toon "<op>" "<op>" ...                  apply ops in order, save (or -o out), print warnings
apollo info song.toon                                    tracks, patterns (id=Track:n), clip grid
apollo render song.toon --loop -o loop.wav               loop range, seamless (no --loop: whole song)
apollo sfx laser --seed 7 --rate 22050 --bits 8 -o laser.wav
apollo sfx from ui.toon --name coin_01 -o coin.wav
apollo sfxall ui.toon -d sounds                          every sound and mix, with the project's export settings
apollo presets | params | packs                          what can be set: engines, presets, drum rows, sfx params
apollo extract song.toon --inst Lead -o lead.toon        also --kit Drums, --keys (keyboard template)
apollo apply song.toon lead.toon --track Bass            preset, kit or keyboard file into the project
apollo code ui.toon --name coin_01                       apollo-sfx code (paste in the page, or "sfx paste <code>")
apollo convert song.toon --to json -o song.json
```
**References:** tracks by id or name; patterns by id or `Track:n` (the number the page shows); bars are 1-based (`1-8`).

**Edit ops**
| op | example |
|---|---|
| song | `song bpm=128 key=D scale=major bars=16 loop=1-4` (loop also `on` / `off`), `master=0.8` |
| mode / level | `mode sfx`, `level music full` |
| track | `track add drum`, `track add melodic name=Keys engine=fm preset=e-piano`, `track set Keys vol=0.6 pan=-0.3 volume=0.7 a=0.01 lpf=0.5`, `track set Lead wave=saw`, `track remove Keys`, `track up Keys` |
| pattern | `pattern add Keys bars=4`, `pattern set Keys:2 bars=8`, `pattern dup 5`, `pattern clear Keys:1`, `pattern remove 5`, `pattern transpose Keys:1 -12` |
| notes | `notes add Keys:1 C4:0:4 Eb4:4:2:0.6 G4:8:8` (note:step:length:velocity:cents), `notes set Drums:1 kick:0-15/4 snare:4,12:1 hat-closed:0-15/2:0.5`, `notes remove Drums:1 kick:4` |
| clip | `clip Keys 1-8 :2` (`:n` = the track's pattern n; a 2-bar pattern lands on bars 1, 3, 5, 7), `clip Drums 5 0` clears |
| kit | `kit set Drums mode=sample`, `kit row Drums snare vol=0.6 tune=0.4 decay=0.3` |
| keys | `keys template "One row" root=C3`, `keys set name=mine root=C4`, `keys bind C3 q`, `keys tune 4 cents=-14` (or `hz=`), `keys equal`, `keys just C` |
| sfx | `sfx add laser seed=3`, `sfx set laser_01 wave=saw freq_ramp=-0.4 lock=base_freq,wave`, `sfx generate laser_01` (keeps locks), `sfx mutate laser_01 amount=0.1`, `sfx variants laser_01 n=6` (makes a set), `sfx paste apollo-sfx:...`, `sfx remove laser_01` |
| mix / set | `mix add pew layers=laser_01@0:100,boom_01@120:70` (sound@delay ms:volume %), `mix layer pew 2 sfx=hit_01 delay=40`, `set add shots items=laser_01,pew` |
| export | `export rate=22050 bits=8 normalize=false` |

`node apollo/tools/pack.js <dir>` rebuilds the sample packs from downloaded sources (needs ffmpeg). Credits: `vendor/sounds/ATTRIBUTION.md`.
