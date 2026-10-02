import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type InspectorNode = {
  id: string;
  title: string;
  instructions: string;
  stepType: string;
  runTarget: string | null;
  hitlRole: string | null;
  beadId: string | null;
};

export function FormulaInspector({
  node,
  onChange,
  onDelete,
  onCloseGate,
  closePending,
}: {
  node: InspectorNode | null;
  onChange: (node: InspectorNode) => void;
  onDelete: (id: string) => void;
  onCloseGate: (beadId: string) => void;
  closePending: boolean;
}) {
  if (!node) {
    return (
      <aside className="w-72 shrink-0 border-l p-4 text-sm text-muted-foreground">
        Select a formula node to edit its step.
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-l p-4">
      <h2 className="text-sm font-medium">Formula node</h2>
      <label className="flex flex-col gap-1 text-xs">
        Step id
        <Input value={node.id} readOnly />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Title
        <Input
          value={node.title}
          onChange={(event) => onChange({ ...node, title: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Instructions
        <Textarea
          value={node.instructions}
          onChange={(event) =>
            onChange({ ...node, instructions: event.target.value })
          }
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Step type
        <Input
          value={node.stepType}
          onChange={(event) =>
            onChange({ ...node, stepType: event.target.value })
          }
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Run target
        <Input
          value={node.runTarget ?? ""}
          placeholder="optional gc.run_target"
          onChange={(event) =>
            onChange({
              ...node,
              runTarget: event.target.value.trim() ? event.target.value : null,
            })
          }
        />
      </label>
      {node.stepType === "gate" && (
        <label className="flex flex-col gap-1 text-xs">
          HITL role
          <Input
            value={node.hitlRole ?? ""}
            onChange={(event) =>
              onChange({
                ...node,
                hitlRole: event.target.value.trim() ? event.target.value : null,
              })
            }
          />
        </label>
      )}
      <Button variant="outline" onClick={() => onDelete(node.id)}>
        Delete node
      </Button>
      {node.stepType === "gate" && node.beadId && (
        <Button
          onClick={() => onCloseGate(node.beadId!)}
          disabled={closePending}
        >
          Close gate bead
        </Button>
      )}
    </aside>
  );
}
