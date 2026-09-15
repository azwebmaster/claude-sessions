/**
 * Claude Code embeds structural markup as literal `<tag>content</tag>` pairs
 * inside otherwise plain text (slash-command turns, system reminders, …).
 * These helpers detect that markup generically — no hardcoded tag list — so
 * previews can render it as something more readable than raw angle brackets.
 */

export type TaggedSegment =
  | { kind: "text"; value: string }
  | { kind: "tag"; tagName: string; value: string };

// Sibling tags only: real transcripts nest command-name/command-message/etc.
// as siblings, never inside one another.
const TAG_PATTERN = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;

export function parseTaggedContent(raw: string): TaggedSegment[] {
  const segments: TaggedSegment[] = [];
  let lastIndex = 0;
  for (const match of raw.matchAll(TAG_PATTERN)) {
    const [full, tagName, value] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", value: raw.slice(lastIndex, index) });
    }
    segments.push({ kind: "tag", tagName, value });
    lastIndex = index + full.length;
  }
  if (lastIndex < raw.length) {
    segments.push({ kind: "text", value: raw.slice(lastIndex) });
  }
  return segments;
}

/**
 * Truncates `raw` to at most `max` characters without ever cutting a
 * `<tag>content</tag>` pair in half. A naive `slice(0, max)` can land inside
 * an open tag before its closing bracket appears — `parseTaggedContent`
 * would then miss it entirely and callers render the raw `<tag>` literally.
 * A tag segment that doesn't fully fit has its value shortened instead, so
 * both brackets always survive; if even the wrapper doesn't fit, the whole
 * segment is dropped rather than left half-written.
 */
export function truncateTaggedContent(raw: string, max: number): string {
  if (raw.length <= max) return raw;
  const segments = parseTaggedContent(raw);
  let out = "";
  for (const segment of segments) {
    const remaining = max - out.length;
    if (remaining <= 0) break;
    if (segment.kind === "text") {
      if (segment.value.length <= remaining) {
        out += segment.value;
        continue;
      }
      out += segment.value.slice(0, remaining);
      break;
    }
    const wrapped = `<${segment.tagName}>${segment.value}</${segment.tagName}>`;
    if (wrapped.length <= remaining) {
      out += wrapped;
      continue;
    }
    const overhead = segment.tagName.length * 2 + 5; // "<n></n>" wrapper length
    const budget = remaining - overhead;
    if (budget > 0) {
      out += `<${segment.tagName}>${segment.value.slice(0, budget)}</${segment.tagName}>`;
    }
    break;
  }
  return `${out.trimEnd()}…`;
}
