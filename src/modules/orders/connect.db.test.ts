// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { describe, expect, it } from "vitest";
import { FakePayments, PaymentError } from "./payments";
import { getPaypalAccount, markPaypalBroken } from "./repo";
import { saveDeliveryAddress } from "@/modules/settings";
import { autoBuySetupProblem, disconnectPaypal, finishPaypalSetup, paymentSetup, startPaypalSetup } from "./service";
import { throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

describe("connecting PayPal", () => {
  it("sends the user to approve, then saves the account when they come back", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    expect(await paymentSetup(userId)).toEqual({ paypal: "none", payerEmail: null, hasAddress: false, suggestedAddress: null });

    const { approveUrl } = await startPaypalSetup(userId, "https://app.test", payments);
    expect(approveUrl).toBe("https://app.test/settings/payment/paypal/return");
    expect((await getPaypalAccount(userId))).toMatchObject({ status: "pending", setupTokenId: "fake-setup-1", vaultId: null });
    expect((await paymentSetup(userId)).paypal).toBe("none"); // not usable until they approve

    expect(await finishPaypalSetup(userId, payments)).toBe("connected");
    expect(await paymentSetup(userId)).toMatchObject({ paypal: "connected", payerEmail: "buyer@sandbox.example" });
  });

  it("says connected again if they refresh the page they came back to", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    expect(await finishPaypalSetup(userId, payments)).toBe("connected");
    expect(await finishPaypalSetup(userId, payments)).toBe("connected");
  });

  it("says there is nothing to finish when they never started", async () => {
    expect(await finishPaypalSetup(await newUser(), new FakePayments())).toBe("nothing-pending");
  });

  it("saves nothing when they didn't approve at PayPal", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    payments.finishSetup = async () => {
      throw new PaymentError("reconnect", "PayPal wasn't approved");
    };
    expect(await finishPaypalSetup(userId, payments)).toBe("not-approved");
    expect((await paymentSetup(userId)).paypal).toBe("none");
  });

  it("keeps the old PayPal working while a new one waits to be approved", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    await startPaypalSetup(userId, "https://app.test", payments);
    expect((await paymentSetup(userId)).paypal).toBe("connected");
  });

  it("asks to reconnect when PayPal has stopped allowing charges, and reconnecting fixes it", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    await markPaypalBroken(userId);
    expect((await paymentSetup(userId)).paypal).toBe("reconnect");
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    expect((await paymentSetup(userId)).paypal).toBe("connected");
  });

  it("forgets the account here and at PayPal when the user disconnects", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    await disconnectPaypal(userId, payments);
    expect((await paymentSetup(userId)).paypal).toBe("none");
    expect(payments.forgotten).toEqual(["fake-vault-fake-setup-1"]);
  });
});

describe("the address PayPal had on file", () => {
  const address = { firstName: "Jane", lastName: "Public", line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", phone: "5125550100" };

  it("is offered to fill in the form, until the user saves their own", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    expect((await paymentSetup(userId)).suggestedAddress).toMatchObject({ line1: "1 Main St", city: "San Jose" });
    expect((await paymentSetup(userId)).hasAddress).toBe(false); // a suggestion is not an address we can ship to

    await saveDeliveryAddress(userId, { ...address, line2: "" });
    expect(await paymentSetup(userId)).toMatchObject({ hasAddress: true, suggestedAddress: null });
  });

  it("is simply absent when PayPal had none", async () => {
    const userId = await newUser();
    const payments = new FakePayments();
    payments.finishSetup = async () => ({ vaultId: "v", payerEmail: null, address: null });
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    expect((await paymentSetup(userId)).suggestedAddress).toBeNull();
  });
});

describe("whether auto-buy may be switched on", () => {
  it("needs PayPal and a delivery address, and says which is missing", async () => {
    const userId = await newUser();
    expect(await autoBuySetupProblem(userId)).toBe("Auto-buy needs you to connect PayPal and add a delivery address first, so we can pay and know where to send it (Settings, Payment & delivery).");

    const payments = new FakePayments();
    await startPaypalSetup(userId, "https://app.test", payments);
    await finishPaypalSetup(userId, payments);
    expect(await autoBuySetupProblem(userId)).toContain("add a delivery address");
    expect(await autoBuySetupProblem(userId)).not.toContain("PayPal first");

    await saveDeliveryAddress(userId, { firstName: "Jane", lastName: "Public", line1: "1 Main St", line2: "", city: "Austin", state: "TX", postalCode: "78701", phone: "5125550100" });
    expect(await autoBuySetupProblem(userId)).toBeNull();
  });
});

