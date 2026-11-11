/** Small runtime helpers shared by the API modules. */

export class TimeoutError extends Error {
  constructor(message = 'The operation timed out.') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown error.';
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof Error) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return false;
}

/** Race a promise against a timer. The timer is always cleared. */
export function withTimeout<T>(promise: Promise<T>, milliseconds: number, message = 'The operation timed out.'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), Math.max(1, Math.floor(milliseconds)));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Read a response body, refusing to buffer more than `maxBytes`. */
export async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - size;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        size += value.byteLength;
      } else {
        chunks.push(value.subarray(0, remaining));
        size += remaining;
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* the stream may already be closed */
    }
  }
  return concatBytes(chunks);
}

export async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const bytes = await readCappedBytes(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

export function headerValue(headers: Headers, name: string): string {
  const value = headers.get(name);
  return value ? value : '';
}
