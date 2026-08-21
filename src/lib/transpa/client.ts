import { getAccessToken, type TranspaCredentials } from "./auth";

export const API_BASE = "https://api.mytranspa.com/publicApi";

/** TransPA svarar med problem+json på fel. */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
}

export class TranspaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly problem?: Problem,
  ) {
    super(message);
    this.name = "TranspaApiError";
  }
}

export interface ListResponse<T> {
  data: T[];
  cursor?: { nextToken?: string | null } | null;
}

export interface RequestOptions {
  /** Filtersträng byggd med lib/transpa/filter.ts. */
  filter?: string;
  limit?: number;
  cursor?: string;
  scopes?: string[];
  signal?: AbortSignal;
}

export interface TranspaClientOptions {
  credentials: TranspaCredentials;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Klient mot TransPA:s Public API.
 *
 * Sköter token, cursor-paginering och felhantering. Pagineringen bär med
 * sig de ursprungliga frågeparametrarna till nästa sida — TransPA kräver
 * att filter och limit upprepas tillsammans med markören, annars
 * returneras fel urval.
 */
export class TranspaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: TranspaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? API_BASE;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await getAccessToken(this.options.credentials, options.scopes, this.fetchImpl);
    const url = new URL(this.baseUrl + path);
    if (options.filter) url.searchParams.set("filter", options.filter);
    if (options.limit) url.searchParams.set("limit", String(options.limit));
    if (options.cursor) url.searchParams.set("cursor", options.cursor);

    const response = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: options.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      let problem: Problem | undefined;
      try {
        problem = JSON.parse(text) as Problem;
      } catch {
        /* svaret var inte problem+json */
      }
      throw new TranspaApiError(
        problem?.detail ?? problem?.title ?? `${response.status} från ${path}`,
        response.status,
        path,
        problem,
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  /**
   * Hämtar alla sidor av en lista.
   *
   * maxPages finns som spärr: en markör som av misstag pekar tillbaka
   * skulle annars ge en oändlig loop mot ett externt API.
   */
  async list<T>(path: string, options: RequestOptions = {}, maxPages = 100): Promise<T[]> {
    const out: T[] = [];
    let cursor = options.cursor;

    for (let page = 0; page < maxPages; page++) {
      const response: ListResponse<T> = await this.request(path, { ...options, cursor });
      out.push(...(response.data ?? []));

      const next = response.cursor?.nextToken;
      if (!next || next === cursor) break;
      cursor = next;
    }
    return out;
  }

  /** Enkel livskontroll. Kräver bara grundscopet. */
  async alive(): Promise<boolean> {
    await this.request("/v1/alive", { scopes: [] });
    return true;
  }
}
