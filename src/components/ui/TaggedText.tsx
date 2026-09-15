import { Chip } from "@mui/material";
import { Fragment, type ReactElement } from "react";
import { parseTaggedContent } from "@shared/taggedContent";

interface TaggedTextProps {
  value: string | null | undefined;
  fallback?: string;
}

/** Renders `<tag>content</tag>` markup as a small chip for the tag name
 *  followed by its content, instead of leaking raw angle brackets. Plain
 *  text (no tags) renders unchanged. */
export function TaggedText({ value, fallback = "" }: TaggedTextProps) {
  if (!value) return <>{fallback}</>;
  const segments = parseTaggedContent(value);
  if (!segments.some((s) => s.kind === "tag")) return <>{value}</>;

  const parts = segments
    .map((segment, i) => {
      if (segment.kind === "text") {
        const trimmed = segment.value.trim();
        return trimmed.length ? <Fragment key={i}>{trimmed}</Fragment> : null;
      }
      const trimmedValue = segment.value.trim();
      return (
        <Fragment key={i}>
          <Chip
            size="small"
            label={segment.tagName}
            sx={{
              height: 18,
              fontSize: "0.62rem",
              borderRadius: 0.75,
              verticalAlign: "middle",
              "& .MuiChip-label": { px: 0.6 },
            }}
          />
          {trimmedValue.length ? ` ${trimmedValue}` : null}
        </Fragment>
      );
    })
    .filter((part): part is ReactElement => part != null);

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? " · " : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
