// File I/O for the tool pages: open / save text with the File System Access API (handles kept, so
// Ctrl+S writes the same file), with an <input type=file> / download fallback; plain file picking,
// downloads and writing several files into a folder.
(DAE => {
  class FileIO {
    /** A hidden file input made on demand (one per page). */
    static #input() {
      let $in = document.getElementById('dae-file-input');
      if(!$in) {
        $in = document.createElement('input');
        Object.assign($in, { type: 'file', id: 'dae-file-input', hidden: true });
        document.body.append($in);
      }
      return $in;
    }

    /** Picks files with the plain file dialog: File[] ([] when cancelled). */
    static pick({ accept = '', multiple = false } = {}) {
      const $in = FileIO.#input();
      Object.assign($in, { accept, multiple, value: '' });
      return new Promise(ok => {
        $in.onchange = () => ok([...$in.files]);
        $in.oncancel = () => ok([]);
        $in.click();
      });
    }

    /**
     * Asks for one text file. `types` is the File System Access filter, `accept` the input fallback.
     * @returns {Promise<{name: string, text: string, handle: FileSystemFileHandle|null}|null>}
     */
    static async open({ types, accept = '' } = {}) {
      if(window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker(types ? { types } : {});
          const file = await handle.getFile();
          return { name: file.name, text: await file.text(), handle };
        }
        catch(err) {
          if(err.name === 'AbortError') return null;
        }
      }
      const [file] = await FileIO.pick({ accept: accept || (types ?? []).flatMap(t => Object.values(t.accept).flat()).join(',') });
      return file ? { name: file.name, text: await file.text(), handle: null } : null;
    }

    /**
     * Saves text (or a Blob). Reuses `handle` unless `as`. Without the API it downloads `name`
     * (asking for a name first when `as` and `ask`).
     * @returns {Promise<FileSystemFileHandle|null|undefined>} the handle, null when downloaded, undefined when cancelled
     */
    static async save(data, { name, types, handle = null, as = false, ask = false, mime = 'text/plain' } = {}) {
      if(window.showSaveFilePicker) {
        try {
          if(as || !handle) handle = await window.showSaveFilePicker({ suggestedName: name, ...(types ? { types } : {}) });
          const w = await handle.createWritable();
          await w.write(data);
          await w.close();
          return handle;
        }
        catch(err) {
          if(err.name === 'AbortError') return undefined;
        }
      }
      if(as && ask) {
        name = prompt('File name', name) ?? '';
        if(!name) return undefined;
      }
      FileIO.download(name, data instanceof Blob ? data : new Blob([data], { type: mime }));
      return null;
    }

    static download(name, blob) {
      const $a = document.createElement('a');
      $a.href = URL.createObjectURL(blob);
      $a.download = name;
      $a.click();
      setTimeout(() => URL.revokeObjectURL($a.href), 2000);
    }

    /**
     * Writes files into a folder the user picks; without the API, downloads them one by one.
     * @param {Array<{name: string, data: BlobPart}>} files
     * @returns {Promise<boolean|undefined>} true in a folder, false as downloads, undefined when cancelled
     */
    static async saveMany(files, { mime = 'application/octet-stream', gap = 300 } = {}) {
      if(window.showDirectoryPicker) {
        try {
          const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
          for(const f of files) {
            const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
            await w.write(f.data);
            await w.close();
          }
          return true;
        }
        catch(err) {
          if(err.name === 'AbortError') return undefined;
        }
      }
      files.forEach((f, i) => setTimeout(() => FileIO.download(f.name, new Blob([f.data], { type: mime })), i * gap));
      return false;
    }
  }

  DAE.FileIO = FileIO;
})(globalThis.DAE ??= {});
if(typeof module === 'object') module.exports = globalThis.DAE;
