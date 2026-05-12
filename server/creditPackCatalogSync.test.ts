import { describe, expect, it } from "vitest";
import { CREDIT_PACK_CREDITS as catalogCredits } from "@shared/creditPackCatalog";
import { CREDIT_PACK_CREDITS as serverCredits } from "./paymentProviders/packages";

describe("credit pack catalog sync", () => {
  it("server re-exports same credits map as shared catalog", () => {
    expect(serverCredits).toBe(catalogCredits);
    expect(catalogCredits.starter).toBe(20);
    expect(catalogCredits.standard).toBe(50);
    expect(catalogCredits.pro).toBe(200);
  });
});
