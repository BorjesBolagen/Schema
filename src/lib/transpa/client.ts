import { getAccessToken, type TranspaCredentials } from "./auth";

export const API_BASE = "https://api.mytranspa.com/publicApi";

/**
 * Största antal rader TransPA ger per sida.
 *
 * Vismas egen dokumentation: "Default and maximum is 100". Begär man
 * fler blir svaret "Invalid limit" — inte en tyst nedklippning — så
 * hela anropet faller.
 */
export const MAX_LIMIT = 100;

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

/**
 * Listsvar från TransPA.
 *
 * Raderna ligger under `items` — så heter nyckeln i Vismas egen
 * OpenAPI-modell (InlineResponse2001: `cursor` + `items`). Jag antog
 * först `data`, vilket gjorde att varje lista tyst blev tom: fel nyckel
 * ger undefined, inte ett fel. `data` står kvar som andrahandsval
 * eftersom den genererade klienten är föråldrad och det live-API:t
 * svarar är det som gäller — men vilken nyckel som faktiskt bar
 * raderna redovisas i stället för att döljas.
 */
export interface ListResponse<T> {
  items?: T[];
  data?: T[];
  cursor?: { nextToken?: string | null } | null;
}

export const ROW_KEYS = ["items", "data"] as const;
export type RowKey = (typeof ROW_KEYS)[number];

export class TranspaShapeError extends Error {
  constructor(
    readonly path: string,
    readonly keys: string[],
  ) {
    super(
      `Svaret från ${path} har varken items eller data som lista. ` +
        `Toppnycklar: ${keys.length ? keys.join(", ") : "inga"}.`,
    );
    this.name = "TranspaShapeError";
  }
}

/**
 * Plockar ut raderna och talar om vilken nyckel de låg under.
 *
 * Kastar hellre än att returnera tomt när ingen av nycklarna bär en
 * lista. Ett tyst [] är precis det som gjorde att synken rapporterade
 * lyckat utan att ha hämtat en enda person.
 */
export function rowsOf<T>(response: unknown, path: string): { rows: T[]; key: RowKey } {
  const body = (response ?? {}) as Record<string, unknown>;
  for (const key of ROW_KEYS) {
    if (Array.isArray(body[key])) return { rows: body[key] as T[], key };
  }
  throw new TranspaShapeError(path, Object.keys(body));
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
    /* Över taket svarar TransPA "Invalid limit" och anropet faller helt.
       Klämmas här och inte hos anroparen: gränsen är API:ts, och ett
       anropsställe som ber om fler ska få så många som går snarare än
       ett fel. Behövs fler rader finns list(), som bläddrar. */
    if (options.limit) {
      url.searchParams.set("limit", String(Math.min(options.limit, MAX_LIMIT)));
    }
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
      out.push(...rowsOf<T>(response, path).rows);

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
