import { DyadShell } from "@/components/dyad-shell";
import { QuestionBoard } from "@/components/question-board";

export const dynamic = "force-dynamic";

export default function HitlPage() {
  return (
    <DyadShell>
      <QuestionBoard />
    </DyadShell>
  );
}
