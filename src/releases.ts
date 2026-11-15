export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface Release {
  tag: string;
  url: string;
}

export class GitHub {
  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
  ) {}

  private async request(
    path: string,
    method: "HEAD" | "GET",
    allowMissing = false,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(`https://github.com/${path}`, {
        method,
        redirect: method === "HEAD" ? "manual" : "follow",
        credentials: "omit",
        headers: { "User-Agent": "myre", "Accept-Encoding": "identity" },
        signal: AbortSignal.timeout(method === "HEAD" ? 30_000 : 300_000),
      });
    } catch (error) {
      throw new Error(
        `GitHub request failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    const redirect =
      method === "HEAD" && [301, 302, 303, 307, 308].includes(response.status);
    if (
      !response.ok &&
      !redirect &&
      !(allowMissing && response.status === 404)
    ) {
      await response.body?.cancel();
      const retryAfter = response.headers.get("retry-after");
      const hint =
        response.status === 403 || response.status === 429
          ? `Public requests are restricted. Try again later.${retryAfter ? ` Retry-After: ${retryAfter}.` : ""}`
          : response.status === 404
            ? "Public release or asset not found."
            : response.statusText;
      throw new Error(`GitHub HTTP ${response.status}: ${hint}`);
    }
    return response;
  }

  async release(
    repository: string,
    tag?: string,
    accept: (release: Release) => boolean = () => true,
  ): Promise<Release> {
    if (!tag) {
      const response = await this.request(
        `${repository}/releases/latest`,
        "HEAD",
      );
      const location = response.headers.get("location");
      if (!location)
        throw new Error("GitHub Latest did not redirect to a release tag.");
      const target = new URL(
        location,
        `https://github.com/${repository}/releases/latest`,
      );
      const prefix = `/${repository}/releases/tag/`;
      if (
        target.origin !== "https://github.com" ||
        !target.pathname.toLowerCase().startsWith(prefix.toLowerCase()) ||
        target.username ||
        target.password ||
        target.search ||
        target.hash
      )
        throw new Error("GitHub Latest returned an unexpected release URL.");
      tag = decodeURIComponent(target.pathname.slice(prefix.length));
    }
    if (
      !tag ||
      /[\x00-\x20\x7f]/.test(tag) ||
      tag.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid release tag.");
    const release = {
      tag,
      url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
    };
    if (!accept(release)) {
      throw new Error(
        `Release ${tag} is outside this tool's release channel. Select a CLI tag with --version.`,
      );
    }
    return release;
  }

  async download(
    repository: string,
    tag: string,
    name: string,
  ): Promise<Response | null> {
    if (!name || name === "." || name === ".." || /[/\\\x00\r\n]/.test(name)) {
      throw new Error("Invalid release asset name.");
    }
    const response = await this.request(
      `${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
      "GET",
      true,
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    return response;
  }
}
