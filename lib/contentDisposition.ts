/** Build a header with an ASCII fallback and a UTF-8 filename (RFC 6266). */
export function createContentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
  fallbackFileName: string
) {
  const name = fileName.toWellFormed().replace(/[\x00-\x1f\x7f/\\]/g, "_").trim() || fallbackFileName;
  const asciiName = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
