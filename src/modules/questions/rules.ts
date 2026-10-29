import { DEFAULT_QUESTION_CONFIG, type QuestionConfig } from "./config";
import { KINDS } from "./kinds";
import type { Answer, Change, ProductFacts, Question } from "./types";

/**
 * The questions worth asking now, most useful first: products with an
 * important question (low or out and unsure, or a count that looks like a
 * typo) come first, the soonest to run out leading; then everything else.
 * Within a product, questions come in the order of KINDS, at most
 * `maxPerProduct` of them. `snoozed` holds "productId:kind" keys to leave out.
 */
export function selectQuestions(
  products: ProductFacts[],
  snoozed: ReadonlySet<string>,
  now: Date,
  config: QuestionConfig = DEFAULT_QUESTION_CONFIG,
): Question[] {
  const perProduct = products.flatMap((facts) => {
    const questions = KINDS.filter((kind) => !snoozed.has(`${facts.id}:${kind.kind}`) && kind.applies(facts, config, now))
      .slice(0, config.maxPerProduct)
      .map(
        (kind): Question => ({
          key: `${facts.id}:${kind.kind}`,
          productId: facts.id,
          productName: facts.name,
          unit: facts.unit,
          kind: kind.kind,
          important: kind.important?.(facts, config) ?? false,
          ...kind.ask(facts, config),
        }),
      );
    return questions.length > 0 ? [{ facts, questions, important: questions.some((q) => q.important) }] : [];
  });

  const urgency = (facts: ProductFacts) => facts.estimate.estimatedRemaining ?? Infinity;
  return perProduct
    .sort((a, b) => Number(b.important) - Number(a.important) || (a.important ? urgency(a.facts) - urgency(b.facts) : 0))
    .flatMap((group) => group.questions);
}

/** What the questions button shows: how many products have something to ask, and whether any of it matters. */
export function summarize(questions: Question[]): { products: number; important: boolean } {
  return { products: new Set(questions.map((q) => q.productId)).size, important: questions.some((q) => q.important) };
}

/** What an answer writes, or null when it doesn't answer a question we would ask about this product now. */
export function changeFor(
  facts: ProductFacts,
  answer: Answer,
  now: Date,
  config: QuestionConfig = DEFAULT_QUESTION_CONFIG,
): Change | null {
  const kind = KINDS.find((k) => k.kind === answer.kind);
  if (!kind || !kind.applies(facts, config, now)) return null;
  return kind.change(facts, answer, config);
}
