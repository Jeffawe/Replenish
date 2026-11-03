import { requireUser } from "@/modules/auth";
import { listSuggestions } from "@/modules/restock";
import { SuggestionCard } from "./suggestion-card";

/** What the last check found for products that are running low, loaded with the dashboard. Nothing shows when there is nothing to say. */
export async function RestockSuggestions() {
  const user = await requireUser();
  const suggestions = await listSuggestions(user.id, new Date());
  if (suggestions.length === 0) return null;

  return (
    <section aria-label="Running low" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <SuggestionCard
              suggestion={{ ...suggestion, searchedAt: suggestion.searchedAt.toISOString().slice(0, 10) }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
