import { describe, expect, it } from "vitest";

import { row, screen } from "../test-support/screen";
import { buildGrid } from "./grid";
import {
  RECOGNITION_SCHEMA_NAME,
  buildRecognitionPrompt,
  recognitionJsonSchema,
} from "./prompt";
import { recognitionSelectionSchema } from "./resolve";

const GRID = buildGrid(
  screen(row("360 Account"), row("可用余额", "6,672.59", "SGD")),
);

describe("recognitionJsonSchema", () => {
  // Derived from the zod schema rather than written out beside it, so the
  // contract the model is given and the contract the resolver enforces cannot
  // drift. zod 4 has this built in, which is why no SDK is needed for it.
  it("is derived from the schema the resolver validates against", () => {
    const schema = recognitionJsonSchema() as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["accounts", "institution"]),
    );
    expect(schema.required).toContain("accounts");
  });

  it("describes an account by the indices it points at", () => {
    const schema = JSON.stringify(recognitionJsonSchema());

    for (const field of [
      "nameBlocks",
      "lastFourBlock",
      "balances",
      "amountBlock",
      "currencyBlock",
    ]) {
      expect(schema).toContain(field);
    }
  });

  // Whatever the model returns still goes through the same parse, so the schema
  // being handed over is never the only thing standing between a bad answer and
  // the app.
  it("describes something the resolver's schema accepts", () => {
    expect(
      recognitionSelectionSchema.safeParse({
        accounts: [{ nameBlocks: [0], balances: [{ amountBlock: 1 }] }],
      }).success,
    ).toBe(true);
  });
});

describe("buildRecognitionPrompt", () => {
  it("puts the serialized screen in the user turn", () => {
    const { user } = buildRecognitionPrompt(GRID);

    expect(user).toContain("COLUMNS none");
    expect(user).toContain('#0 "360 Account"');
  });

  // The single most important instruction: the model's whole answer is indices.
  it("tells the model to answer with indices and never with text", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/index/i);
    expect(system).toMatch(/never (copy|type|write)/i);
  });

  // Backed by the samples: OCBC's and China Merchants' overview screens carry
  // no brand name anywhere, and what identifies them is "360 Account", "GSA",
  // "朝朝宝", "买理财，来招行". A model told to look for a brand string finds
  // nothing on 7 of 17 real screenshots.
  it("tells the model to infer the institution rather than search for a brand", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/product name/i);
    expect(system).toMatch(/may not appear|might not appear|is often absent/i);
  });

  it("tells the model to leave the institution blank rather than guess", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/leave it (blank|empty)/i);
  });

  // A card's balance is what is owed, and the minus is often in the LABEL
  // rather than in the figure ("您花了 4,766.92"). Nothing about the digits
  // says so, so the model has to be told to look at what is beside them.
  it("tells the model how to report a debt", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/owe|debt|spent/i);
  });

  // A trailing check digit makes the mechanical tail-four wrong
  // ("012-394-2-033676-3" is 3676, not 6763), and the per-institution rule that
  // knew this is gone.
  it("tells the model it may name the four digits itself", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/check digit|last four/i);
  });

  // Screenshots are taken wherever the user happened to be scrolled, so a
  // page-level total may be absent entirely. Reconstructing one would be a
  // number nothing on screen supports.
  it("tells the model to report only what is on screen", () => {
    const { system } = buildRecognitionPrompt(GRID);

    expect(system).toMatch(/only what (is|you can see)/i);
  });

  describe("the institutions the user already has", () => {
    // Someone with six institutions on file gives the model a prior that
    // collapses most of the ambiguity, and it costs one line of prompt.
    it("offers them as candidates", () => {
      const { system } = buildRecognitionPrompt(GRID, {
        knownInstitutions: ["OCBC", "China Merchants Bank"],
      });

      expect(system).toContain("OCBC");
      expect(system).toContain("China Merchants Bank");
    });

    // A prior, not a menu: the seventh institution has to be recognizable too.
    it("says they are a hint rather than a closed list", () => {
      const { system } = buildRecognitionPrompt(GRID, {
        knownInstitutions: ["OCBC"],
      });

      expect(system).toMatch(/not a limit|another institution/i);
    });

    it("says nothing about them when the user has none yet", () => {
      const { system } = buildRecognitionPrompt(GRID, {
        knownInstitutions: [],
      });

      expect(system).not.toMatch(/already holds accounts with/i);
    });

    it("says nothing about them when none were supplied", () => {
      expect(buildRecognitionPrompt(GRID).system).not.toMatch(
        /already holds accounts with/i,
      );
    });
  });

  it("names the output contract the same way the request does", () => {
    expect(RECOGNITION_SCHEMA_NAME).toBe("recognized_accounts");
  });
});
