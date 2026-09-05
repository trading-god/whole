// JSON Schema → GBNF, for grammars-constrained decoding.
//
// The recognition loop tells the model what shape its answer must take; a
// grammar makes that shape UNRETURNABLE to violate, which is the difference
// between "we reject a malformed field" and "a small on-device model cannot
// emit one" — the failure class a 2B quant is most prone to. It has to be GBNF
// because both runtimes (llama.rn on device, node-llama-cpp in the harness)
// take a grammar string per completion, not a JSON Schema.
//
// The conversion delegates to the vendored llama.cpp reference converter
// (`json-schema-to-grammar.js`): grammar correctness against llama.cpp's
// engine is not something a unit test can establish, so it is bought from the
// authoritative implementation and kept identical between the app (llama.rn)
// and the eval harness (node-llama-cpp).
import { SchemaConverter } from "./json-schema-to-grammar.js";

// A `pattern` the converter cannot express reaches llama.cpp as garbage rather
// than as an error. The converter copies an escape it does not recognize
// straight into a GBNF quoted literal, and llama.cpp's grammar parser then
// refuses the whole grammar ("unknown escape at \d") — so EVERY completion
// fails to start, on a schema every unit test accepts. That shipped once, as
// the `\d` in the last-four pattern, and `pnpm eval:ocr:llama` was the only
// thing that saw it.
//
// So the character classes are rejected here, at the conversion, rather than
// forbidden by a comment on each schema that might one day be compiled. Write
// `[0-9]`, `[A-Za-z0-9_]`, `[ \t\r\n]` instead.
const UNSUPPORTED_PATTERN_ESCAPE = /\\[dDwWsSbB]/;

function assertGrammarSafePatterns(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      assertGrammarSafePatterns(item, `${path}[${index}]`),
    );
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "pattern" &&
      typeof value === "string" &&
      UNSUPPORTED_PATTERN_ESCAPE.test(value)
    ) {
      throw new Error(
        `${path}.pattern uses a character class GBNF cannot parse (${value}). Spell it out — [0-9] rather than \\d.`,
      );
    }
    assertGrammarSafePatterns(value, `${path}.${key}`);
  }
}

/**
 * Compiles a JSON Schema (as `z.toJSONSchema` emits it) into a GBNF grammar
 * whose root rule accepts exactly the schema's values.
 *
 * `resolveRefs` must run before `visit` because zod deduplicates reused
 * subschemas into `$defs` and leaves `#/$defs/...` refs behind; the walk is
 * async only for the remote-fetch branch this engine never takes.
 */
export async function jsonSchemaToGrammar(schema: unknown): Promise<string> {
  assertGrammarSafePatterns(schema, "schema");
  const converter = new SchemaConverter({ allow_fetch: false });
  await converter.resolveRefs(schema, "");
  converter.visit(schema, "");
  return converter.formatGrammar();
}
