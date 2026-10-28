import type { OcrWord } from "./ocr/types";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

interface Placed {
  text: string;
  left: number;
  right: number;
  y: number;
  /** Rise per unit of x, from the word's own angle after straightening. */
  slope: number;
}

/** Words that sit side by side: a name, or a price with its "$" and tax flag. */
interface Run {
  words: Placed[];
  slope: number;
}

const first = (run: Run) => run.words[0];
const last = (run: Run) => run.words[run.words.length - 1];
/** Where the run's line of text would be at `x` if it carried on. */
const yAt = (run: Run, x: number) => last(run).y + run.slope * (x - last(run).right);

/**
 * Puts the words an OCR engine found back into the rows of the receipt, one
 * string per printed line, top to bottom. An item's name and its price sit far
 * apart on a receipt, and engines often report them as separate pieces of
 * text, so rows are rebuilt from where the words are, not from the engine's
 * own line breaks.
 *
 * A photo is never perfectly square to the receipt, so the words are first
 * rotated by the angle most of them agree on. A curled receipt still leaves
 * the names sloping while the price column is level, so a row is followed
 * left to right along its own slope: the name's line is carried across to the
 * price column, and the price joins the row that line runs into. A big gap
 * inside a row (between the name and the price) is kept as two spaces.
 */
export function groupIntoRows(words: OcrWord[]): string[] {
  if (words.length === 0) return [];

  // Average the directions as vectors so angles either side of +-180 degrees don't cancel.
  const tilt = Math.atan2(
    words.reduce((sum, w) => sum + Math.sin(w.angle), 0),
    words.reduce((sum, w) => sum + Math.cos(w.angle), 0),
  );
  const cos = Math.cos(-tilt);
  const sin = Math.sin(-tilt);
  const placed: Placed[] = words.map((word) => {
    const x = word.cx * cos - word.cy * sin;
    return {
      text: word.text,
      left: x - word.width / 2,
      right: x + word.width / 2,
      y: word.cx * sin + word.cy * cos,
      slope: Math.tan(word.angle - tilt),
    };
  });

  const lineHeight = median(words.map((w) => w.height)) || 1;
  const wideGap = lineHeight * 2.5;
  const leftToRight = (a: { left: number }, b: { left: number }) => a.left - b.left;

  // Join words into runs: the next word starts close after the last one, on its line.
  const runs: Run[] = [];
  for (const word of placed.sort(leftToRight)) {
    const run = closest(
      runs.filter((r) => word.left - last(r).right <= wideGap && word.left > last(r).left),
      (r) => Math.abs(yAt(r, word.left) - word.y),
      lineHeight * 0.5,
    );
    if (run) {
      run.words.push(word);
      run.slope = run.words.reduce((sum, w) => sum + w.slope, 0) / run.words.length;
    } else {
      runs.push({ words: [word], slope: word.slope });
    }
  }

  // Join runs into rows: a run continues the row whose line it lies on, judged
  // along the line of the row's first run (the name's slope is the reliable one).
  const rows: Run[][] = [];
  for (const run of runs.sort((a, b) => first(a).left - first(b).left)) {
    const row = closest(
      rows.filter((r) => last(r[r.length - 1]).right < first(run).left + lineHeight * 0.5),
      (r) => {
        const end = last(r[r.length - 1]);
        return Math.abs(end.y + r[0].slope * (first(run).left - end.right) - first(run).y);
      },
      lineHeight * 0.6,
    );
    if (row) row.push(run);
    else rows.push([run]);
  }

  const meanY = (row: Run[]) => {
    const all = row.flatMap((run) => run.words);
    return all.reduce((sum, w) => sum + w.y, 0) / all.length;
  };
  return rows
    .map((row) => ({ y: meanY(row), row }))
    .sort((a, b) => a.y - b.y)
    .map(({ row }) =>
      row
        .map((run, i) => {
          const text = run.words.map((w) => w.text).join(" ");
          if (i === 0) return text;
          const gap = first(run).left - last(row[i - 1]).right;
          return (gap > wideGap ? "  " : " ") + text;
        })
        .join(""),
    );
}

/** The candidate with the smallest distance, if it is within `limit`. */
function closest<T>(candidates: T[], distance: (candidate: T) => number, limit: number): T | null {
  let best: T | null = null;
  let bestDistance = limit;
  for (const candidate of candidates) {
    const d = distance(candidate);
    if (d <= bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}
