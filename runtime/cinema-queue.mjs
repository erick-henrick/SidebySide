import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';

export async function createQueue(filename) {
  let state = { revision: 0, current: null, items: [], history: [] };
  try {
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    state = { ...state, ...saved };
    if (!Array.isArray(state.items) || !Array.isArray(state.history)) throw new Error('Arquivo da fila inválido.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let pending = Promise.resolve();
  function snapshot() { return structuredClone(state); }
  function mutate(change) {
    const operation = pending.then(async () => {
      const draft = snapshot();
      change(draft);
      draft.revision += 1;
      await writeFile(filename + '.tmp', JSON.stringify(draft, null, 2), 'utf8');
      await rename(filename + '.tmp', filename);
      state = draft;
      return snapshot();
    });
    pending = operation.catch(() => {});
    return operation;
  }
  function entry(video) {
    return { id: randomUUID(), videoId: video.videoId,
      title: String(video.title || 'Vídeo ' + video.videoId).slice(0, 200),
      channel: String(video.channel || '').slice(0, 120),
      duration: String(video.duration || '').slice(0, 20) };
  }
  return {
    snapshot,
    entry,
    add(video) {
      return mutate(draft => { draft.items.push(entry(video)); });
    },
    remove(id) {
      return mutate(draft => {
        const index = draft.items.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Esse vídeo já saiu da fila.');
        draft.items.splice(index, 1);
      });
    },
    move(id, offset) {
      return mutate(draft => {
        const index = draft.items.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Esse vídeo já saiu da fila.');
        const destination = index + offset;
        if (destination < 0 || destination >= draft.items.length) return;
        const [item] = draft.items.splice(index, 1);
        draft.items.splice(destination, 0, item);
      });
    },
    begin(video) {
      return mutate(draft => {
        if (draft.current && draft.current.id !== video.id) {
          draft.history.push(draft.current);
          draft.history = draft.history.slice(-30);
        }
        draft.current = { ...video };
        draft.items = draft.items.filter(item => item.id !== video.id);
      });
    },
  };
}
