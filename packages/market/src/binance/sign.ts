import { createHmac } from 'node:crypto';

export function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.join('&');
}

/** 签名查询串：query + '&timestamp=' + ts + '&signature=' + hmac */
export function buildSignedQuery(
  params: Record<string, string | number | boolean | undefined>,
  secret: string,
  timestamp: number,
  recvWindow = 5000,
): string {
  const base = buildQueryString({ ...params, timestamp, recvWindow });
  const sig = hmacSha256(secret, base);
  return base + '&signature=' + sig;
}
