/**
 * Strip markdown-bold markers from structured field headers in LLM output.
 *
 * DeepSeek inconsistently wraps the uppercase field headers it was instructed
 * to emit in markdown bold, producing any of three forms for the same field:
 *
 *   URGENCY: medium          (plain — what the prompt asks for)
 *   **URGENCY**: medium      (bold wraps name, colon outside)
 *   **URGENCY:** medium      (bold wraps name AND colon)
 *
 * Downstream parsers in this codebase use regexes like
 *   /URGENCY:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is
 * which (a) fail to match the first bold variant entirely because `URGENCY:`
 * never appears contiguously, (b) match the second variant but capture a
 * leading `** ` token that breaks enum validation downstream (urgency silently
 * falls back to "medium"), and (c) can't find the next-field lookahead when
 * subsequent headers are also bolded, causing captures to run to EOS.
 *
 * Normalizing every header to the plain form before running any regex makes
 * the existing parser logic work reliably. Only ALL-CAPS identifiers are
 * touched, so inline content bold ("**Save** button", "**Key observations**"
 * narrative preambles) is preserved.
 */
export function normalizeFieldHeaders(text: string): string {
  return text.replace(/\*\*([A-Z][A-Z_]*)(?::\*\*|\*\*:)/g, '$1:');
}
