import { describe, expect, it } from "vitest";

import { knownAssetKinds } from "../contract/asset-kind";
import { annotationJsonSchema } from "./recognize";
import { jsonSchemaToGrammar } from "./grammar";

// The unit tests assert STRUCTURE only — that the grammar names the right
// rules, enumerates the right literals, and closes over the whole schema.
// Whether llama.cpp's engine actually PARSES the output is not something a
// unit test can establish; that burden sits with the eval harness
// (`pnpm eval:ocr:llama`), which feeds this exact grammar to node-llama-cpp.
// A grammar change that passes here but breaks there must fail THERE.
describe("jsonSchemaToGrammar", () => {
  it("names the root rule", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    expect(grammar).toContain("root ::= ");
  });

  it("enumerates the closed asset kinds", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    // Driven off the contract's own list rather than restated here: a fourth
    // kind reaches the grammar through `assetKindSchema`, and this test must
    // follow it there.
    for (const kind of knownAssetKinds) {
      expect(grammar).toContain(`\\"${kind}\\"`);
    }
  });

  it("carries a rule for every field the recognition loop validates", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    // Rule names are derived from the property paths by the vendored
    // converter. If a field is renamed or added, this list names the
    // contract the grammar must re-enter.
    for (const rule of [
      "root ::=",
      "institution ::=",
      "institution-displayName ::=",
      "institution-alternates ::=",
      "accounts ::=",
      "accounts-item-group ::=",
      "accounts-item-kind ::=",
    ]) {
      expect(grammar).toContain(rule);
    }
  });

  it("makes every annotation field unskippable", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    // The measured reason the schema has no optional fields: a grammar that
    // permits the shorter object gets the shorter object, and a skipped
    // `accounts` reads as "no region has a kind" rather than as a violation
    // to retry. `( "," space ( accounts-kv ) )?` in the root is what that
    // regression looks like, so the root is asserted literally.
    expect(grammar).toContain(
      'root ::= "{" space institution-kv "," space homeCurrency-kv "," space accounts-kv "}" space',
    );
    expect(grammar).toContain(
      'accounts-item ::= "{" space accounts-item-group-kv "," space accounts-item-kind-kv "}" space',
    );
    // …and `unknown` is how a kind declines, so required is not a demand to guess.
    expect(grammar).toContain('\\"unknown\\"');
  });

  it("bounds every repetition the model can fall into", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    // An unbounded string or array compiles to an unbounded rule, and a small
    // quant that falls into a repetition loop then runs to the output ceiling
    // mid-answer — unparseable JSON, three times over. Bounded, the loop is
    // unreturnable, which is what the grammar is for.
    expect(grammar).toContain('institution-displayName ::= "\\"" char{1,64}');
    expect(grammar).toMatch(/institution-alternates-item\)\{0,3\}/);
    expect(grammar).toMatch(/accounts-item\)\{0,62\}/);
  });

  it("compiles a region number to a bounded digit range", async () => {
    const grammar = await jsonSchemaToGrammar(annotationJsonSchema());

    // Digits, no sign, no fraction, and 1..63 — a model steered by this
    // grammar cannot emit a region number the annotation schema would reject,
    // and cannot emit 0, which is what a 0-based answer would look like (every
    // kind off by one, and nothing to retry because it holds the contract).
    // Bounded, because the unbounded safe-integer range expands into a rule
    // that is kilobytes long (see MAX_REGION_NUMBER).
    expect(grammar).toContain(
      "accounts-item-group ::= ([1-9] | ([1-5] [0-9] | [6] [0-3])) space",
    );
    expect(grammar).not.toContain("9007199254740991");
  });
});

describe("the GBNF-hostile pattern gate", () => {
  it.each([
    ["a top-level pattern", { type: "string", pattern: "^\\d{4}$" }],
    [
      "a nested pattern",
      {
        type: "object",
        properties: { tail: { type: "string", pattern: "^\\w+$" } },
      },
    ],
    [
      "a pattern inside an array",
      { anyOf: [{ type: "string", pattern: "^\\s$" }] },
    ],
  ])("rejects %s", async (_name, schema) => {
    // The converter would copy the escape into a quoted GBNF literal and
    // llama.cpp would refuse the whole grammar at load, which no unit test
    // and no engine assertion can see. Failing at the conversion is the
    // earliest place the mistake is visible.
    await expect(jsonSchemaToGrammar(schema)).rejects.toThrow(
      /GBNF cannot parse/,
    );
  });

  it("accepts the spelled-out class", async () => {
    const grammar = await jsonSchemaToGrammar({
      type: "string",
      pattern: "^[0-9]{4}$",
    });

    expect(grammar).toContain("root ::=");
  });
});
