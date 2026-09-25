import { useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKnowledgeItems } from "@/hooks/useKnowledgeItems";

export function KnowledgeBaseContents({ appId }: { appId: number }) {
  const { items, isLoading, createItem, isCreating, deleteItem } =
    useKnowledgeItems(appId);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [member, setMember] = useState("");

  const canSubmit =
    title.trim().length > 0 && url.trim().length > 0 && !isCreating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    await createItem({
      title: title.trim(),
      url: url.trim(),
      addedBy: member.trim() || undefined,
    });
    setTitle("");
    setUrl("");
  };

  return (
    <div data-testid="knowledge-base-contents">
      <h3 className="text-lg font-semibold tracking-tight">Contents</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Links and references the phases can rely on.
      </p>

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Item name"
            placeholder="Item name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="flex-1"
          />
          <Input
            aria-label="Member"
            placeholder="Member (optional)"
            value={member}
            onChange={(event) => setMember(event.target.value)}
            className="sm:max-w-40"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Link"
            placeholder="https://…"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!canSubmit} className="shrink-0">
            <Plus size={16} />
            <span>Add</span>
          </Button>
        </div>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b px-3 py-2 text-left text-sm font-medium text-muted-foreground">
                Item
              </th>
              <th className="border-b px-3 py-2 text-left text-sm font-medium text-muted-foreground">
                Link
              </th>
              <th className="border-b px-3 py-2 text-left text-sm font-medium text-muted-foreground">
                Added
              </th>
              <th className="border-b px-3 py-2 text-left text-sm font-medium text-muted-foreground">
                Member
              </th>
              <th className="border-b px-3 py-2 text-right text-sm font-medium text-muted-foreground">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-sm text-muted-foreground"
                >
                  Loading contents…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-4 text-sm text-muted-foreground"
                >
                  No contents yet. Add the first link above.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} data-testid={`knowledge-item-${item.id}`}>
                  <td className="border-b px-3 py-3 align-top text-sm font-medium">
                    {item.title}
                  </td>
                  <td className="border-b px-3 py-3 align-top text-sm">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-48 items-center gap-1 truncate text-primary underline-offset-4 hover:underline"
                      title={item.url}
                    >
                      <ExternalLink size={14} className="shrink-0" />
                      <span className="truncate">
                        {item.url.replace(/^https?:\/\//, "")}
                      </span>
                    </a>
                  </td>
                  <td className="border-b px-3 py-3 align-top text-sm text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="border-b px-3 py-3 align-top text-sm">
                    {item.addedBy || "—"}
                  </td>
                  <td className="border-b px-3 py-3 align-top text-right text-sm">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${item.title}`}
                      onClick={() => void deleteItem(item.id)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
