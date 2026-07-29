import { describe, it, expect } from "vitest";
import { buildSourceDescriptionPrefix } from "../tool-metadata.js";

describe("buildSourceDescriptionPrefix", () => {
  it("returns empty string when description is undefined", () => {
    expect(buildSourceDescriptionPrefix(undefined)).toBe("");
  });

  it("returns empty string when description is empty", () => {
    expect(buildSourceDescriptionPrefix("")).toBe("");
  });

  it("returns empty string when description is whitespace-only", () => {
    expect(buildSourceDescriptionPrefix("   ")).toBe("");
    expect(buildSourceDescriptionPrefix("\t\n")).toBe("");
  });

  it("appends '. ' when description has no sentence-ending punctuation", () => {
    expect(buildSourceDescriptionPrefix("Prod DB")).toBe("Prod DB. ");
  });

  /*
   * Sentence terminators get only a trailing space, never an extra '.':
   * - '.' guards against the classic "Prod DB.. Execute SQL..." double-period bug.
   * - ':' naturally introduces what follows (the tool template), so adding '.'
   *   would produce the artifact "Details below:. Execute...".
   */
  it.each([
    ["Prod DB.", "Prod DB. "],
    ["Production DB!", "Production DB! "],
    ["Query me?", "Query me? "],
    ["Details below:", "Details below: "],
  ])("appends only a space when description ends with a terminator (%s)", (input, expected) => {
    expect(buildSourceDescriptionPrefix(input)).toBe(expected);
  });

  it("trims surrounding whitespace before assessing punctuation", () => {
    expect(buildSourceDescriptionPrefix("  Prod DB  ")).toBe("Prod DB. ");
    expect(buildSourceDescriptionPrefix("  Prod DB.  ")).toBe("Prod DB. ");
  });

  it("preserves internal whitespace and punctuation", () => {
    // Internal formatting (newlines, multiple words, mid-sentence punctuation)
    // is the user's intent and must not be altered.
    expect(buildSourceDescriptionPrefix("Line 1\nLine 2")).toBe("Line 1\nLine 2. ");
    expect(buildSourceDescriptionPrefix("Line A, Line B")).toBe("Line A, Line B. ");
  });

  it("does not treat non-sentence-ending punctuation as terminators", () => {
    // ')' and ';' are mid-sentence / structural punctuation; the helper
    // should still append ". " to produce a complete sentence boundary.
    // (':' is handled separately — see the colon-specific test above.)
    expect(buildSourceDescriptionPrefix("(read-only)")).toBe("(read-only). ");
    expect(buildSourceDescriptionPrefix("Clause 1; clause 2")).toBe("Clause 1; clause 2. ");
  });
});
