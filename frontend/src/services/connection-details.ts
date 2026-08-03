function normalizedOrigin(origin: string): string {
  return origin.replace(/\/+$/u, '');
}

export function ddnsUpdateUrl(origin: string, slug: string): string {
  return `${normalizedOrigin(origin)}/api/ddns/${encodeURIComponent(slug)}`;
}

export function curlCommand(origin: string, slug: string, token: string): string {
  return `curl -X POST ${ddnsUpdateUrl(origin, slug)} -H 'Authorization: Bearer ${token}'`;
}

export function unifiSettings(origin: string, slug: string, hostname: string, token: string): string {
  const url = new URL(normalizedOrigin(origin));
  return `服務: 自訂\n主機名稱: ${hostname}\n使用者名稱: ${slug}\n密碼: ${token}\n伺服器: ${url.host}/api/compat/unifi/${encodeURIComponent(slug)}?hostname=`;
}
