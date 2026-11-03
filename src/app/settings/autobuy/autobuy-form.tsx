"use client";

import { useActionState } from "react";
import { MIN_AUTOBUY_CONFIDENCE, type UserSettings } from "@/modules/settings/client";
import { saveAutobuySettingsAction, type SettingsFormState } from "../actions";
import { Field, INPUT, SaveBar, Suffix } from "../fields";

const IDLE: SettingsFormState = { status: "idle" };
const FLOOR_PERCENT = Math.round(MIN_AUTOBUY_CONFIDENCE * 100);

/** 1250 -> "12.5", null -> "" (the input's own value). */
const dollars = (cents: number | null) => (cents === null ? "" : String(cents / 100));

export function AutobuyForm({ settings }: { settings: UserSettings }) {
  const [state, formAction, pending] = useActionState(saveAutobuySettingsAction, IDLE);
  const errors = state.fieldErrors ?? {};
  const props = (name: string) => ({
    id: name,
    name,
    "aria-describedby": `${name}-help`,
    "aria-invalid": errors[name]?.length ? true : undefined,
  });
  const priceError = errors.minPrice?.[0] ?? errors.maxPrice?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <h2 className="text-base font-semibold">Limits</h2>

      <Field
        label="Only buy when we're at least this sure"
        id="minConfidencePercent"
        error={errors.minConfidencePercent?.[0]}
        hint={`${FLOOR_PERCENT}% is the lowest we allow. We get surer as we see more of your purchases of a product. Below this, we ask you instead of buying.`}
      >
        <div className="flex items-center gap-2">
          <input
            {...props("minConfidencePercent")}
            type="number"
            inputMode="numeric"
            min={FLOOR_PERCENT}
            max="100"
            step="1"
            defaultValue={Math.round(settings.autobuyMinConfidence * 100)}
            className={INPUT}
          />
          <Suffix>%</Suffix>
        </div>
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Only buy at a price between</span>
        <div className="flex items-center gap-2">
          <Suffix>$</Suffix>
          <input
            {...props("minPrice")}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Least"
            aria-label="Least price"
            defaultValue={dollars(settings.autobuyMinPriceCents)}
            className={INPUT}
          />
          <Suffix>and $</Suffix>
          <input
            {...props("maxPrice")}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="Most"
            aria-label="Most price"
            defaultValue={dollars(settings.autobuyMaxPriceCents)}
            className={INPUT}
          />
        </div>
        <p id="minPrice-help" className={priceError ? "text-sm text-rose-700 dark:text-rose-300" : "text-sm text-zinc-500 dark:text-zinc-400"}>
          {priceError ?? "Per item. Leave either blank for no limit. A product can have its own range in its Edit dialog."}
        </p>
      </div>

      <Field
        label="Spend at most this much a month"
        id="monthlyCap"
        error={errors.monthlyCap?.[0]}
        hint="Across everything we buy for you. Leave blank for no cap."
      >
        <div className="flex items-center gap-2">
          <Suffix>$</Suffix>
          <input
            {...props("monthlyCap")}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            defaultValue={dollars(settings.autobuyMonthlyCapCents)}
            className={INPUT}
          />
        </div>
      </Field>

      <Field
        label="Order this many days before it runs out"
        id="leadDays"
        error={errors.leadDays?.[0]}
        hint="Gives the order time to arrive before you're out."
      >
        <div className="flex items-center gap-2">
          <input {...props("leadDays")} type="number" inputMode="numeric" min="0" max="60" step="1" defaultValue={settings.autobuyLeadDays} className={INPUT} />
          <Suffix>days</Suffix>
        </div>
      </Field>

      <SaveBar pending={pending} status={state.status} message={state.message} />
    </form>
  );
}
