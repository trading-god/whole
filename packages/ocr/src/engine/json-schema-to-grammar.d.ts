// Types for the vendored llama.cpp json-schema-to-grammar converter
// (`json-schema-to-grammar.js`). Only the surface the wrapper in
// `grammar.ts` uses is declared — the converter itself stays byte-for-byte
// upstream, untyped.
export declare class SchemaConverter {
  constructor(options?: {
    /** Property order hints, keyed by schema name. Unused here. */
    prop_order?: Record<string, string[] | number[]>;
    /** Remote `$ref` fetches are never wanted in the engine. */
    allow_fetch?: boolean;
    /** Make `.` in JSON Schema `pattern` regexes match newlines. */
    dotall?: boolean;
  });
  /**
   * Walks the schema and inlines `$ref` targets into `_refs`.
   * Required before `visit()` for any schema carrying refs — zod's
   * `toJSONSchema` emits local `#/$defs/...` refs for reused subschemas.
   */
  resolveRefs(schema: unknown, url: string): Promise<void>;
  /** Produces the grammar rules for `schema`, named `name` ("" → `root`). */
  visit(schema: unknown, name: string): string;
  /** Renders every accumulated rule as `name ::= rule` lines. */
  formatGrammar(): string;
}
