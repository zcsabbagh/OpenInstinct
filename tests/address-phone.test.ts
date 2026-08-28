import { describe, expect, it } from "vitest";
import {
  formatAddressSingleLine,
  parseAddressSecret,
  serializeAddress,
} from "../lib/manager/address";
import { managerMutationSchema } from "../lib/manager";
import { composePhoneNumber, phoneSecretSchema } from "../lib/manager/phone";

describe("address vault values", () => {
  it("serializes and round-trips a complete structured address", () => {
    const secret = serializeAddress({
      city: "Brooklyn",
      country: "United States",
      kind: "address",
      line1: "1 Main St",
      line2: "Apt 4B",
      postalCode: "11217",
      region: "NY",
      version: 1,
    });

    const parsed = parseAddressSecret(secret);
    expect(parsed).toEqual(
      expect.objectContaining({
        city: "Brooklyn",
        line1: "1 Main St",
        line2: "Apt 4B",
        postalCode: "11217",
        region: "NY",
      })
    );
    expect(formatAddressSingleLine(parsed)).toBe(
      "1 Main St, Apt 4B, Brooklyn, NY, 11217, United States"
    );
  });

  it("omits an empty optional line2 from the single-line format", () => {
    const address = parseAddressSecret(
      serializeAddress({
        city: "Austin",
        country: "United States",
        kind: "address",
        line1: "500 Congress Ave",
        line2: "",
        postalCode: "78701",
        region: "TX",
        version: 1,
      })
    );
    expect(formatAddressSingleLine(address)).toBe(
      "500 Congress Ave, Austin, TX, 78701, United States"
    );
  });

  it("falls back to a single free-text line for a pre-structured legacy value", () => {
    const parsed = parseAddressSecret("221B Baker Street, London");
    expect(parsed.line1).toBe("221B Baker Street, London");
    expect(parsed.city).toBe("");
    expect(formatAddressSingleLine(parsed)).toBe("221B Baker Street, London");
  });

  it("rejects an incomplete address when creating a vault item", () => {
    const incomplete = managerMutationSchema.safeParse({
      action: "vault.create",
      input: {
        account: "",
        kind: "address",
        label: "Home",
        secret: serializeAddress({
          city: "Brooklyn",
          country: "US",
          kind: "address",
          line1: "1 Main St",
          line2: "",
          postalCode: "11217",
          region: "NY",
          version: 1,
        }).slice(0, -1), // truncate to invalid JSON
      },
    });
    expect(incomplete.success).toBe(false);

    const complete = managerMutationSchema.safeParse({
      action: "vault.create",
      input: {
        account: "",
        kind: "address",
        label: "Home",
        secret: serializeAddress({
          city: "Brooklyn",
          country: "US",
          kind: "address",
          line1: "1 Main St",
          line2: "",
          postalCode: "11217",
          region: "NY",
          version: 1,
        }),
      },
    });
    expect(complete.success).toBe(true);
  });
});

describe("phone vault values", () => {
  it("composes a national number with the selected calling code", () => {
    expect(composePhoneNumber("+1", "555 555 5555")).toBe("+15555555555");
    expect(composePhoneNumber("+44", "20 7946 0958")).toBe("+442079460958");
  });

  it("prefers a pasted international number over the selected calling code", () => {
    expect(composePhoneNumber("+1", "+91 98765 43210")).toBe("+919876543210");
  });

  it("validates loosely across country formats without a US-shaped assumption", () => {
    expect(phoneSecretSchema.safeParse("+15555555555").success).toBe(true);
    expect(phoneSecretSchema.safeParse("+442079460958").success).toBe(true);
    expect(phoneSecretSchema.safeParse("+919876543210").success).toBe(true);
    expect(phoneSecretSchema.safeParse("+85212345678").success).toBe(true);
  });

  it("rejects a number missing a country code or with invalid characters", () => {
    expect(phoneSecretSchema.safeParse("5555555555").success).toBe(false);
    expect(phoneSecretSchema.safeParse("+1 555 555 5555").success).toBe(false);
    expect(phoneSecretSchema.safeParse("+0123456789").success).toBe(false);
    expect(phoneSecretSchema.safeParse("not-a-number").success).toBe(false);
  });

  it("rejects an invalid phone number when creating a vault item", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "vault.create",
        input: {
          account: "",
          kind: "phone",
          label: "Mobile",
          secret: "555-5555",
        },
      }).success
    ).toBe(false);

    expect(
      managerMutationSchema.safeParse({
        action: "vault.create",
        input: {
          account: "",
          kind: "phone",
          label: "Mobile",
          secret: "+15555555555",
        },
      }).success
    ).toBe(true);
  });
});
