// Armazenamento local em IndexedDB. Tudo fica só neste aparelho.

const STORES = ['lists', 'tasks', 'log', 'meta'];
let database;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function openDb() {
  const request = indexedDB.open('tarefas', 1);
  request.onupgradeneeded = () => {
    STORES.forEach((name) => request.result.createObjectStore(name, { keyPath: 'id' }));
  };
  database = await promisify(request);
}

const store = (name, mode = 'readonly') => database.transaction(name, mode).objectStore(name);

export const getAll = (name) => promisify(store(name).getAll());
export const put = (name, value) => promisify(store(name, 'readwrite').put(value));
export const remove = (name, id) => promisify(store(name, 'readwrite').delete(id));

/** Substitui todos os dados de uma vez; se algo falhar, nada muda. */
export function replaceAll(data) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES, 'readwrite');
    STORES.forEach((name) => {
      const target = transaction.objectStore(name);
      target.clear();
      (data[name] || []).forEach((item) => target.put(item));
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export const get = (name, id) => promisify(store(name).get(id));
