class Lifetime {
  constructor() { this.controller = new AbortController(); this.cleanups = []; }
  get signal() { return this.controller.signal; }
  own(fn) { if (this.signal.aborted) fn(); else this.cleanups.push(fn); return fn; }
  listen(target, event, fn, options) { target.addEventListener(event, fn, options); return this.own(() => target.removeEventListener(event, fn, options)); }
  interval(fn, ms) { const id = setInterval(fn, ms); return this.own(() => clearInterval(id)); }
  dispose() { if (this.signal.aborted) return; this.controller.abort(); for (const fn of this.cleanups.splice(0).reverse()) { try { fn(); } catch (e) { console.error('Home Widgets cleanup', e); } } }
}
class Bus {
  constructor() { this.topics = new Map(); }
  on(topic, fn) { if (!this.topics.has(topic)) this.topics.set(topic, new Set()); this.topics.get(topic).add(fn); return () => { const set=this.topics.get(topic); set?.delete(fn); if (!set?.size) this.topics.delete(topic); }; }
  emit(topic, value) { for (const fn of [...(this.topics.get(topic) || [])]) { try { fn(value); } catch (e) { console.error('Home Widgets listener', e); } } }
  changed(path) { this.emit('file:' + path, path); const parts=path.split('/'); parts.pop(); while (parts.length) { this.emit('folder:' + parts.join('/'), path); parts.pop(); } this.emit('folder:',path); }
}
module.exports = { Lifetime, Bus };
