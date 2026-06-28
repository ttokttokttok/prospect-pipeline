// Server-only (uses Buffer). Never import from client components.
export function encodeId(linkedinUrl: string): string {
  return Buffer.from(linkedinUrl, "utf8").toString("base64url");
}

export function decodeId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}
