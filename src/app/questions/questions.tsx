import { getDemoUser } from "@/lib/demo-user";
import { CHECK_IN, getQuestions, summarize } from "@/modules/questions";
import { CheckIn } from "./check-in";
import { QuestionsButton } from "./questions-button";

/** The questions button and the occasional check-in, loaded together. */
export async function Questions() {
  const user = await getDemoUser();
  const questions = await getQuestions(user.id);
  const { products, important } = summarize(questions);
  return (
    <>
      <QuestionsButton questions={questions} products={products} important={important} />
      <CheckIn questions={questions} count={CHECK_IN.questions} everyDays={CHECK_IN.everyDays} />
    </>
  );
}
