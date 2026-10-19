import { ProtocolHandshakeException } from "./protocol.js";

/** Exchanges a persistent anonymous browser session for a fresh connection token. */
export class AnonymousAccessTokenProvider {
  public readonly authorizationUrl: URL;
  public readonly connectUrl: URL;
  public expiresAt?: Date;
  private cookie?: string;
  private pending?: Promise<string>;
  private readonly transport: typeof fetch;

  constructor({ resource, authorizationUrl = "/.well-known/meshagent/authorize", fetch: transport = globalThis.fetch }: {
    resource: "room" | "agent";
    authorizationUrl?: string | URL;
    fetch?: typeof fetch;
  }) {
    this.authorizationUrl = new URL(authorizationUrl, (globalThis as { location?: { href: string } }).location?.href);
    if (!["http:", "https:"].includes(this.authorizationUrl.protocol)) {
      throw new Error("anonymous authorization requires an HTTP(S) URL");
    }
    this.connectUrl = new URL(`/.well-known/meshagent/${resource}/connect`, this.authorizationUrl);
    this.transport = transport;
  }

  public getToken(): Promise<string> {
    // Share concurrent exchanges so first use cannot create competing identities.
    if (this.pending == null) {
      this.pending = this.exchange().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async exchange(): Promise<string> {
    const issuedAt = Date.now();
    const response = await this.transport(this.authorizationUrl, {
      method: "POST",
      credentials: "include",
      redirect: "error",
      headers: this.cookie == null ? undefined : { Cookie: this.cookie },
    });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      // Reverse proxies may return HTML error pages; never expose their markup.
      const message = detail && !detail.startsWith("<") ? detail.slice(0, 2048) : response.statusText;
      throw new ProtocolHandshakeException({
        statusCode: response.status,
        statusText: message || "Anonymous authorization failed",
        errorCode: [401, 403].includes(response.status) ? "anonymous_access_denied" : "anonymous_authorization_failed",
      });
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ProtocolHandshakeException({ statusCode: 400, statusText: "Invalid anonymous authorization response: expected JSON", errorCode: "invalid_anonymous_authorization_response" }); }
    if (body == null || typeof body !== "object"
      || !("jwt" in body) || typeof body.jwt !== "string" || body.jwt.length === 0
      || !("connect_path" in body) || body.connect_path !== this.connectUrl.pathname
      || !("expires_in" in body) || typeof body.expires_in !== "number"
      || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
      throw new ProtocolHandshakeException({ statusCode: 400, statusText: "Invalid anonymous authorization response", errorCode: "invalid_anonymous_authorization_response" });
    }
    // Browsers manage HttpOnly cookies themselves. Node fetch exposes Set-Cookie
    // but has no cookie jar, so retain this endpoint's session cookie there.
    const cookie = response.headers.get("set-cookie")?.match(/(?:^|,\s*)__meshagent_anonymous=([^; ,]+)/);
    if (cookie != null) this.cookie = `__meshagent_anonymous=${cookie[1]}`;
    this.expiresAt = new Date(issuedAt + body.expires_in * 1000);
    return body.jwt;
  }
}
