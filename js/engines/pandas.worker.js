// Classic Web Worker hosting Pyodide + pandas. The main thread can terminate it to cancel a runaway run.
// Messages in:  {id,type:'init', pyodideBase, prelude, clean:{name:csv}, raw:{name:csv}}
//               {id,type:'exec', code, frameset:'clean'|'raw'}
// Messages out: {id, ok, result|error}  and  {type:'progress', stage}
/* global importScripts, loadPyodide */
let pyodide = null;

function progress(stage) { self.postMessage({ type: 'progress', stage }); }

async function init(msg) {
  progress('Loading Python runtime (Pyodide)… ~10–20 s the first time');
  importScripts(msg.pyodideBase + 'pyodide.js');
  pyodide = await loadPyodide({ indexURL: msg.pyodideBase });
  progress('Loading pandas + numpy…');
  await pyodide.loadPackage(['pandas', 'numpy']);
  progress('Loading the university dataset…');
  pyodide.runPython(msg.prelude);
  pyodide.globals.set('CLEAN_JSON', JSON.stringify(msg.clean));
  pyodide.globals.set('RAW_JSON', JSON.stringify(msg.raw));
  pyodide.runPython(`
import json
FRAMES = {
    'clean': load_frames(json.loads(CLEAN_JSON)),
    'raw': {**load_frames(json.loads(RAW_JSON)['raw'], raw=True), **load_frames(json.loads(RAW_JSON)['ref'])},
}
del CLEAN_JSON, RAW_JSON
harden()
`);
  progress('ready');
}

function exec(msg) {
  pyodide.globals.set('USER_CODE', msg.code);
  pyodide.globals.set('FRAMESET', msg.frameset || 'clean');
  const json = pyodide.runPython('json.dumps(run_user(USER_CODE, FRAMES[FRAMESET]))');
  return JSON.parse(json);
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') { await init(msg); self.postMessage({ id: msg.id, ok: true }); }
    else if (msg.type === 'exec') self.postMessage({ id: msg.id, ok: true, result: exec(msg) });
    else self.postMessage({ id: msg.id, ok: false, error: 'unknown message ' + msg.type });
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
