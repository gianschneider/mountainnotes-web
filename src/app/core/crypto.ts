/**
 * Encryption at rest for note contents and photos on the phone (AES-256-GCM, WebCrypto).
 *
 * The key is generated on the device and is not extractable. It is kept in IndexedDB; on iOS WebKit wraps
 * stored CryptoKeys with a master key from the keychain. Protects against reading the app files (backups,
 * file access), not against someone using the unlocked app itself (the app enforces the unlock rules).
 */
const PREFIX = 'enc1:';
const DB_NAME = 'mountainnotes-keys';
const STORE = 'keys';
const KEY_ID = 'local-data-v1';

let keyPromise: Promise<CryptoKey> | undefined;

export async function encryptText(text: string): Promise<string> {
  const { iv, data } = await encrypt(new TextEncoder().encode(text));
  return `${PREFIX}${toBase64(iv)}:${toBase64(data)}`;
}

/** Decrypts a value written by encryptText; older plaintext values are returned unchanged (migration). */
export async function decryptText(value: string): Promise<string> {
  if (!value.startsWith(PREFIX)) return value;
  const [iv, data] = value.slice(PREFIX.length).split(':');
  return new TextDecoder().decode(await decrypt(fromBase64(iv), fromBase64(data)));
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Base64 bytes (e.g. a JPEG) → base64 of iv + ciphertext, for files. */
export async function encryptBase64(base64: string): Promise<string> {
  const { iv, data } = await encrypt(fromBase64(base64));
  const out = new Uint8Array(iv.byteLength + data.byteLength);
  out.set(new Uint8Array(iv), 0);
  out.set(new Uint8Array(data), iv.byteLength);
  return PREFIX + toBase64(out.buffer);
}

/** Reverse of encryptBase64; files written before encryption are returned unchanged. */
export async function decryptBase64(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;
  const bytes = new Uint8Array(fromBase64(stored.slice(PREFIX.length)));
  return toBase64(await decrypt(bytes.slice(0, 12).buffer, bytes.slice(12).buffer));
}

async function encrypt(plain: ArrayBuffer | Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), plain as BufferSource);
  return { iv: iv.buffer, data };
}

async function decrypt(iv: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), data);
}

function key(): Promise<CryptoKey> {
  keyPromise ??= loadOrCreateKey().catch((err) => {
    keyPromise = undefined;                 // allow a retry later
    throw err;
  });
  return keyPromise;
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const db = await openDb();
  const existing = await request<CryptoKey | undefined>(db.transaction(STORE).objectStore(STORE).get(KEY_ID));
  if (existing) return existing;
  const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(created, KEY_ID));
  return created;
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return request(open);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
