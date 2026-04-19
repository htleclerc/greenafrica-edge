const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080';
const API_SECRET = process.env.AIS_INGEST_SECRET ?? '';

interface BackendRequestInit extends Omit<RequestInit, 'headers'> {
    headers?: Record<string, string>;
}

export async function backendFetch(path: string, init?: BackendRequestInit): Promise<Response> {
    const url = `${BACKEND_URL}${path}`;
    return fetch(url, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_SECRET}`,
            ...init?.headers,
        },
    });
}

export async function backendGet<T>(path: string): Promise<T> {
    const res = await backendFetch(path);
    if (!res.ok) throw new Error(`Backend ${path}: ${res.status}`);
    return res.json() as Promise<T>;
}

export async function backendPost<T>(path: string, body: unknown): Promise<T> {
    const res = await backendFetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Backend POST ${path}: ${res.status}`);
    return res.json() as Promise<T>;
}
