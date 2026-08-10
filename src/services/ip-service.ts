import type { RecordType } from '../domain/models';

function parseIpv4(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function ipv6Segments(value: string): number[] | null {
  let input = value.toLowerCase();
  if (input.includes('%')) return null;
  const ipv4Tail = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (ipv4Tail) {
    const bytes = parseIpv4(ipv4Tail);
    if (!bytes) return null;
    input = input.slice(0, -ipv4Tail.length) + `${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/u.test(input) || (input.match(/::/gu)?.length ?? 0) > 1) return null;
  const [headRaw, tailRaw] = input.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const tail = tailRaw ? tailRaw.split(':') : [];
  if ([...head, ...tail].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - head.length - tail.length;
  if ((input.includes('::') && missing < 1) || (!input.includes('::') && missing !== 0)) return null;
  return [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail].map((part) => Number.parseInt(part, 16));
}

export function ipVersion(value: string): 4 | 6 | null {
  if (parseIpv4(value)) return 4;
  if (ipv6Segments(value)) return 6;
  return null;
}

function isPublicIpv4(parts: number[]): boolean {
  const [a, b, c] = parts as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPublicIpv6(parts: number[]): boolean {
  const first = parts[0]!;
  const allZero = parts.every((part) => part === 0);
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  const multicast = (first & 0xff00) === 0xff00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const documentation = first === 0x2001 && parts[1] === 0x0db8;
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  const globalUnicast = (first & 0xe000) === 0x2000;
  const benchmarking = first === 0x2001 && parts[1] === 0x0002 && parts[2] === 0;
  const orchid = first === 0x2001 && (((parts[1]! & 0xfff0) === 0x0010) || ((parts[1]! & 0xfff0) === 0x0020));
  return globalUnicast && !(allZero || loopback || multicast || linkLocal || uniqueLocal || documentation || ipv4Mapped || benchmarking || orchid);
}

export function isAllowedIp(value: string, recordType: RecordType, allowPrivate = false): boolean {
  const v4 = parseIpv4(value);
  if (recordType === 'A') return Boolean(v4 && (isPublicIpv4(v4) || (allowPrivate && isPrivateIpv4(v4))));
  const v6 = ipv6Segments(value);
  const uniqueLocal = Boolean(v6 && (v6[0]! & 0xfe00) === 0xfc00);
  return Boolean(v6 && (isPublicIpv6(v6) || (allowPrivate && uniqueLocal)));
}

export function sourceIp(request: Request, recordType: RecordType, allowPrivate = false): string | null {
  const connectingIp = request.headers.get('CF-Connecting-IP')?.trim();
  return connectingIp && isAllowedIp(connectingIp, recordType, allowPrivate) ? connectingIp : null;
}

export function rateLimitSource(request: Request): string | null {
  const connectingIp = request.headers.get('CF-Connecting-IP')?.trim().toLowerCase();
  return connectingIp && ipVersion(connectingIp) !== null ? connectingIp : null;
}
