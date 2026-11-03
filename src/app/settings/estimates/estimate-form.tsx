"use client";

import { useActionState } from "react";
import { saveEstimateSettingsAction, type SettingsFormState } from "../actions";
import { Field, INPUT, SaveBar, Suffix } from "../fields";

const IDLE: SettingsFormState = { status: "idle" };

export function EstimateForm({ thresholdDays, defaultDays }: { thresholdDays: number | null; defaultDays: number }) {
  const [state, formAction, pending] = useActionState(saveEstimateSettingsAction, IDLE);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        label="Call a product low when it is about this many days from running out"
        id="lowStockThresholdDays"
        error={errors.lowStockThresholdDays?.[0]}
        hint={`Leave blank to use the default of ${defaultDays} days.`}
      >
        <div className="flex items-center gap-2">
          <input
            id="lowStockThresholdDays"
            name="lowStockThresholdDays"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            placeholder={String(defaultDays)}
            defaultValue={thresholdDays ?? ""}
            aria-describedby="lowStockThresholdDays-help"
            aria-invalid={errors.lowStockThresholdDays?.length ? true : undefined}
            className={INPUT}
          />
          <Suffix>days</Suffix>
        </div>
      </Field>
      <SaveBar pending={pending} status={state.status} message={state.message} />
    </form>
  );
}
