import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import {
  FORMULA_PHASES,
  formulaPhaseLabel,
  type FormulaPhase,
} from "@/lib/formula/phases";

export function FormulaPage({ phase }: { phase: FormulaPhase }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["formula", phase],
    queryFn: () => ipc.formula.get({ phase }),
  });
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!query.data) return;
    setText(query.data.text);
  }, [phase, query.data]);

  const validate = useMutation({
    mutationFn: () => ipc.formula.validate({ phase, text }),
    onSuccess: (result) => {
      setErrors(result.errors);
      setNotice(result.valid ? "Formula is acceptable." : null);
    },
    onError: (error: Error) => {
      setNotice(null);
      setErrors([error.message]);
    },
  });

  const save = useMutation({
    mutationFn: () => ipc.formula.save({ phase, text }),
    onSuccess: async (result) => {
      setText(result.text);
      setErrors(result.errors);
      setNotice(result.valid ? "Saved." : null);
      if (result.valid) {
        await queryClient.invalidateQueries({ queryKey: ["formula", phase] });
      }
    },
    onError: (error: Error) => {
      setNotice(null);
      setErrors([error.message]);
    },
  });

  const undo = useMutation({
    mutationFn: () => ipc.formula.undo({ phase }),
    onSuccess: async (result) => {
      setText(result.text);
      setErrors([]);
      setNotice("Restored the previous formula.");
      await queryClient.invalidateQueries({ queryKey: ["formula", phase] });
    },
    onError: (error: Error) => {
      setNotice(null);
      setErrors([error.message]);
    },
  });

  const configured = query.data?.supervisorConfigured === true;
  const busy = validate.isPending || save.isPending || undo.isPending;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <h1 className="text-2xl font-semibold">
        {formulaPhaseLabel(phase)} formula
      </h1>
      <div className="flex gap-2">
        {FORMULA_PHASES.map((item) => (
          <Button
            key={item}
            type="button"
            variant={item === phase ? "default" : "outline"}
            onClick={() =>
              navigate({
                to: "/formulas/$phase",
                params: { phase: item },
              })
            }
          >
            {formulaPhaseLabel(item)}
          </Button>
        ))}
      </div>
      {query.isLoading ? <p>Loading formula…</p> : null}
      {query.error ? <p>{(query.error as Error).message}</p> : null}
      {query.data && !configured ? (
        <p>GasCity supervisor is not configured.</p>
      ) : null}
      {query.data?.source === "starter" && configured ? (
        <p>Showing the starter. It is written when you save.</p>
      ) : null}
      <textarea
        aria-label={`${formulaPhaseLabel(phase)} formula`}
        className="border-input bg-background min-h-80 w-full rounded-md border p-3 font-mono text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {notice ? <p>{notice}</p> : null}
      {errors.length > 0 ? (
        <ul>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!configured || busy}
          onClick={() => validate.mutate()}
        >
          Validate
        </Button>
        <Button
          type="button"
          disabled={!configured || busy}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!configured || !query.data?.canUndo || busy}
          onClick={() => undo.mutate()}
        >
          Undo
        </Button>
      </div>
    </div>
  );
}
