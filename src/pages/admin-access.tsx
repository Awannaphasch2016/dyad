import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { AdminRoleId } from "@/lib/adminAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showError } from "@/lib/toast";

export default function AdminAccessPage() {
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["admin-access"],
    queryFn: () => ipc.clerk.getAccess(),
  });
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<AdminRoleId>("member");
  const [pending, setPending] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-access"] });

  const invite = async () => {
    setPending(true);
    try {
      await ipc.clerk.inviteMember({ email, roleId });
      setEmail("");
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  };

  const changeRole = async (userId: string, nextRole: AdminRoleId) => {
    setPending(true);
    try {
      await ipc.clerk.setMemberRole({ userId, roleId: nextRole });
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  };

  const data = access.data;

  return (
    <div className="min-h-screen w-full px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Members &amp; permissions
            </h1>
          </div>
          {data?.signInUrl && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                as="a"
                href={data.signInUrl}
                target="_blank"
                rel="noreferrer"
              >
                Sign in
              </Button>
              {data.signUpUrl && (
                <Button
                  as="a"
                  href={data.signUpUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Sign up
                </Button>
              )}
            </div>
          )}
        </div>

        {access.isLoading && (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        )}
        {access.error && (
          <p className="text-sm text-destructive">
            {access.error instanceof Error
              ? access.error.message
              : "Couldn't load members."}
          </p>
        )}
        {data && !data.configured && (
          <p className="text-sm text-muted-foreground">
            Clerk keys are not loaded yet. Add them to the environment and
            reopen wewebplus.
          </p>
        )}

        {data && (
          <section
            data-testid="admin-members"
            aria-labelledby="admin-members-heading"
          >
            <h2
              id="admin-members-heading"
              className="mb-3 text-lg font-semibold tracking-tight"
            >
              Members
            </h2>
            <div className="grid grid-cols-[1fr_11rem] border-b px-3 py-2 text-sm font-medium">
              <span>Member</span>
              <span>Role</span>
            </div>
            {data.members.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No members yet. Invite someone by email.
              </p>
            )}
            <ul>
              {data.members.map((member) => (
                <li
                  key={member.id}
                  className="grid grid-cols-[1fr_11rem] items-center gap-2 border-b px-3 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {member.name}
                    </span>
                    {member.name !== member.email && (
                      <span className="block truncate text-muted-foreground">
                        {member.email}
                      </span>
                    )}
                    {member.status === "invited" && (
                      <span className="text-xs text-muted-foreground">
                        Invited
                      </span>
                    )}
                  </span>
                  {member.status === "active" ? (
                    <select
                      aria-label={`Role for ${member.email}`}
                      className="h-9 rounded-md border bg-transparent px-2"
                      value={member.roleId}
                      disabled={pending}
                      onChange={(event) =>
                        void changeRole(
                          member.id,
                          event.target.value as AdminRoleId,
                        )
                      }
                    >
                      {data.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>
                      {data.roles.find((role) => role.id === member.roleId)
                        ?.name ?? member.roleId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="mt-4 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void invite();
              }}
            >
              <Input
                aria-label="Member email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="max-w-sm"
              />
              <select
                aria-label="Role for new member"
                className="h-9 rounded-md border bg-transparent px-2"
                value={roleId}
                onChange={(event) =>
                  setRoleId(event.target.value as AdminRoleId)
                }
              >
                {(data.roles.length ? data.roles : []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={pending || !data.configured}>
                Add member
              </Button>
            </form>
          </section>
        )}

        {data && (
          <section
            className="flex flex-col gap-4"
            aria-labelledby="admin-permissions-heading"
            data-testid="admin-permissions"
          >
            <h2
              id="admin-permissions-heading"
              className="text-lg font-semibold tracking-tight"
            >
              Permissions
            </h2>
            <div>
              <h3 className="mb-3 text-base font-semibold">Roles</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {data.roles.map((role) => (
                  <article
                    key={role.id}
                    data-testid={`admin-role-${role.id}`}
                    className="rounded-xl border bg-[var(--background-lightest)] p-4"
                  >
                    <h4 className="text-base font-semibold">{role.name}</h4>
                    <ul className="mt-3 space-y-1 text-sm">
                      {role.permissions.map((permission) => (
                        <li key={permission.id}>{permission.label}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
