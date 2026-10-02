import { cn } from "@/lib/utils";
import { organizationColor, organizationInitial } from "./organizationColor";

export function OrganizationMark({
  name,
  accountId,
  className,
}: {
  name: string;
  accountId: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-semibold text-white",
        className,
      )}
      style={{ backgroundColor: organizationColor(accountId) }}
    >
      {organizationInitial(name)}
    </span>
  );
}
