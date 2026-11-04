import { requireUser } from "@/modules/auth";
import { listSuggestions } from "@/modules/restock";
import { getUserSettings, platformLimits } from "@/modules/settings";
import { SuggestionCarousel } from "./suggestion-carousel";

/** What the last check found for products that are running low, loaded with the dashboard. Nothing shows when there is nothing to say. */
export async function RestockSuggestions() {
  const user = await requireUser();
  const [suggestions, settings] = await Promise.all([listSuggestions(user.id, new Date()), getUserSettings(user.id)]);
  if (suggestions.length === 0) return null;

  return <SuggestionCarousel skipConfirm={settings.skipBuyConfirm} maxOrderCents={platformLimits().buyNowOrderCents} suggestions={suggestions.map((suggestion) => ({ ...suggestion, searchedAt: suggestion.searchedAt.toISOString().slice(0, 10) }))} />;
}
