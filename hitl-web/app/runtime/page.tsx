import { DyadShell } from "@/components/dyad-shell";
import { RuntimeBoundary } from "@/components/runtime-boundary";

export const dynamic = "force-dynamic";

export default function RuntimePage() {
  return (
    <DyadShell>
      <RuntimeBoundary />
    </DyadShell>
  );
}
