"use client";

import { useActionState } from "react";
import type { DeliveryAddress } from "@/modules/settings/client";
import { type SettingsFormState } from "../actions";
import { Field, INPUT, SaveBar } from "../fields";
import { saveDeliveryAddressAction } from "./actions";

const IDLE: SettingsFormState = { status: "idle" };

/** `address` may be only part of one (what PayPal had on file): the form is filled with it for the user to finish and save. */
export function DeliveryForm({ address, saved }: { address: Partial<DeliveryAddress> | null; saved: boolean }) {
  const [state, formAction, pending] = useActionState(saveDeliveryAddressAction, IDLE);
  const errors = state.fieldErrors ?? {};
  // Everything but the apartment line is needed: Zinc won't place an order without a full address.
  const field = (name: keyof DeliveryAddress, label: string, extra: { autoComplete: string; hint?: string; inputMode?: "tel" | "numeric"; placeholder?: string; className?: string }) => (
    <div className={extra.className}>
      <Field label={label} id={name} error={errors[name]?.[0]} hint={extra.hint} required={name !== "line2"}>
        <input
          id={name}
          name={name}
          required={name !== "line2"}
          type={name === "phone" ? "tel" : "text"}
          inputMode={extra.inputMode}
          autoComplete={extra.autoComplete}
          placeholder={extra.placeholder}
          defaultValue={address?.[name] ?? ""}
          aria-describedby={`${name}-help`}
          aria-invalid={errors[name]?.length ? true : undefined}
          className={INPUT}
        />
      </Field>
    </div>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "First name", { autoComplete: "given-name" })}
        {field("lastName", "Last name", { autoComplete: "family-name" })}
      </div>
      {field("line1", "Street address", { autoComplete: "address-line1" })}
      {field("line2", "Apartment, suite (optional)", { autoComplete: "address-line2" })}
      <div className="grid gap-4 sm:grid-cols-6">
        {field("city", "City", { autoComplete: "address-level2", className: "sm:col-span-3" })}
        {field("state", "State", { autoComplete: "address-level1", placeholder: "CA", className: "sm:col-span-1" })}
        {field("postalCode", "ZIP code", { autoComplete: "postal-code", inputMode: "numeric", className: "sm:col-span-2" })}
      </div>
      {field("phone", "Phone", { autoComplete: "tel", inputMode: "tel", hint: "The carrier may call this if there's a problem delivering." })}
      {saved && (
        <Field label="Your password, if you're changing the address" id="currentPassword" error={errors.currentPassword?.[0]} hint="This is where we send what we charge you for, so we check it's you.">
          <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" aria-describedby="currentPassword-help" aria-invalid={errors.currentPassword?.length ? true : undefined} className={INPUT} />
        </Field>
      )}
      <SaveBar pending={pending} status={state.status} message={state.message} />
    </form>
  );
}
