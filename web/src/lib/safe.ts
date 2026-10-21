const HTTPS = /^https:\/\//i;
const MEDIA_SRC = /^media\/[\w\-.~/]+$/;

/** The URL when it is https, else null: data links never become javascript: or http: hrefs. */
export function safeUrl(url: string | null | undefined): string | null {
  return url && HTTPS.test(url) ? url : null;
}

/** A relative media/… path from the export, else null. */
export function safeSrc(src: string | null | undefined): string | null {
  return src && MEDIA_SRC.test(src) && !src.includes("..") ? src : null;
}
