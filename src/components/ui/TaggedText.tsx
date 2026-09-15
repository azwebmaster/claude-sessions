import { Box, Chip } from "@mui/material";
import { Fragment, type ReactElement } from "react";
import { parseTaggedContent, type TaggedSegment } from "@shared/taggedContent";

interface TaggedTextProps {
  value: string | null | undefined;
  fallback?: string;
}

const chipSx = {
  height: 18,
  fontSize: "0.62rem",
  borderRadius: 0.75,
  verticalAlign: "middle",
  "& .MuiChip-label": { px: 0.6 },
} as const;

// Slightly smaller than a top-level chip so a nested cluster still reads as
// compact when it lands in a space-constrained spot (tooltips, table cells,
// rail rows) rather than the roomier turn context panel.
const nestedChipSx = {
  ...chipSx,
  height: 16,
  fontSize: "0.58rem",
} as const;

type TagSegment = Extract<TaggedSegment, { kind: "tag" }>;

/** Renders one `<tag>` segment: its chip, plus either its trimmed text value
 *  or — when the value itself contained further tags — the nested tags'
 *  own chips. The nested case clusters the parent chip and its children in
 *  one tight inline group (a faint background, no border) so the group
 *  reads as one unit instead of blending into unrelated sibling chips at
 *  the same level. */
function TagChip({ segment, nested = false }: { segment: TagSegment; nested?: boolean }) {
  const sx = nested ? nestedChipSx : chipSx;

  if (segment.children.length === 0) {
    const trimmedValue = segment.value.trim();
    return (
      <>
        <Chip size="small" label={segment.tagName} sx={sx} />
        {trimmedValue.length ? ` ${trimmedValue}` : null}
      </>
    );
  }

  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.3,
        verticalAlign: "middle",
        bgcolor: "action.hover",
        borderRadius: 1,
        px: 0.4,
        py: 0.1,
      }}
    >
      <Chip size="small" label={segment.tagName} sx={sx} />
      {segment.children.map((child, i) =>
        child.kind === "text" ? (
          child.value.trim().length ? (
            <Fragment key={i}>{child.value.trim()}</Fragment>
          ) : null
        ) : (
          <TagChip key={i} segment={child} nested />
        ),
      )}
    </Box>
  );
}

/** Renders `<tag>content</tag>` markup as a small chip for the tag name
 *  followed by its content, instead of leaking raw angle brackets. A tag
 *  whose content itself contains further tags (e.g. `<task-notification>`
 *  wrapping `<task-id>`/`<tool-use-id>`) renders those as nested chips
 *  clustered against the parent, rather than as raw text. Plain text (no
 *  tags) renders unchanged. */
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
      return (
        <Fragment key={i}>
          <TagChip segment={segment} />
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
