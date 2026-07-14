import { describe, expect, it } from "vitest";
import {
  canonicalizeEsgDriverCountry,
  canonicalizeEsgDriverSector,
  ESG_DRIVER_COUNTRY_OPTIONS,
  ESG_DRIVER_SECTOR_OPTIONS,
} from "../coverage";

describe("ESG driver evidence coverage", () => {
  it.each([
    ["UAE", "UAE"],
    ["United Arab Emirates", "UAE"],
    ["KSA", "Saudi Arabia"],
    ["Kingdom of Saudi Arabia", "Saudi Arabia"],
    ["Republic of Kazakhstan", "Kazakhstan"],
  ])("canonicalizes the supported country alias %s", (input, expected) => {
    expect(canonicalizeEsgDriverCountry(input)).toBe(expected);
  });

  it.each([
    ["Banking", "Banking"],
    ["Financial services", "Banking"],
    ["Cement", "Construction"],
    ["Property", "Real Estate"],
    ["Oil and gas", "Oil & Gas"],
  ])("canonicalizes the supported sector alias %s", (input, expected) => {
    expect(canonicalizeEsgDriverSector(input)).toBe(expected);
  });

  it("rejects scopes without approved evidence coverage", () => {
    expect(canonicalizeEsgDriverCountry("Canada")).toBeNull();
    expect(canonicalizeEsgDriverSector("Telecommunications")).toBeNull();
    expect(canonicalizeEsgDriverSector("Renewable Energy")).toBeNull();
  });

  it("publishes stable UI options", () => {
    expect(ESG_DRIVER_COUNTRY_OPTIONS).toEqual([
      "UAE",
      "Saudi Arabia",
      "Kazakhstan",
    ]);
    expect(ESG_DRIVER_SECTOR_OPTIONS).toEqual([
      "Banking",
      "Construction",
      "Real Estate",
      "Oil & Gas",
    ]);
  });
});
