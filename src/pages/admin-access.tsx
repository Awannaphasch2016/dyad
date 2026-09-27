import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { canManageMembers } from "@/auth/permissions";
import { useClerkRole } from "@/auth/session";
import { ipc } from "@/ipc/types";
import type { AdminRoleId } from "@/lib/adminAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const tableHeadClass =
  "border-b px-3 py-2 text-left text-sm font-medium text-muted-foreground";
const tableCellClass = "border-b px-3 py-3 align-top text-sm";

export default function AdminAccessPage() {
  const queryClient = useQueryClient();
  const clerkRole = useClerkRole();
  // UX only. Main still accepts invite and role changes with the secret key.
  const manageMembers = canManageMembers(clerkRole.status, clerkRole.roleId);
  const access = useQuery({
    queryKey: ["admin-access"],
    queryFn: () => ipc.clerk.getAccess(),
  });
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<AdminRoleId>("reviewer");
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
        <h1 className="text-2xl font-semibold tracking-tight">
          Members &amp; permissions
        </h1>

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
          <section data-testid="admin-members" className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={tableHeadClass}>Member</th>
                  <th className={cn(tableHeadClass, "w-[11rem]")}>Role</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-4 text-sm text-muted-foreground"
                    >
                      {manageMembers
                        ? "No members yet. Invite someone by email below."
                        : "No members yet."}
                    </td>
                  </tr>
                )}
                {data.members.map((member) => (
                  <tr key={member.id}>
                    <td className={tableCellClass}>
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
                    </td>
                    <td className={tableCellClass}>
                      {member.status === "active" ? (
                        <select
                          aria-label={`Role for ${member.email}`}
                          className="h-9 w-full rounded-md border bg-transparent px-2"
                          value={member.roleId}
                          disabled={pending || !manageMembers}
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
                    </td>
                  </tr>
                ))}
                {!manageMembers && (
                  <tr>
                    <td
                      colSpan={2}
                      className={cn(
                        tableCellClass,
                        "border-b-0 text-muted-foreground",
                      )}
                      data-testid="admin-manage-note"
                    >
                      Only admins can invite members or change roles.
                    </td>
                  </tr>
                )}
                {manageMembers && (
                  <tr>
                    <td
                      colSpan={2}
                      className={cn(tableCellClass, "border-b-0")}
                    >
                      <form
                        data-testid="admin-invite-form"
                        className="flex flex-wrap items-center gap-2"
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
                          className="max-w-sm flex-1"
                        />
                        <select
                          aria-label="Role for new member"
                          className="h-9 rounded-md border bg-transparent px-2"
                          value={roleId}
                          onChange={(event) =>
                            setRoleId(event.target.value as AdminRoleId)
                          }
                        >
                          {data.roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="submit"
                          disabled={pending || !data.configured}
                        >
                          Add member
                        </Button>
                      </form>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {data && (
          <section
            data-testid="admin-roles-table"
            className="overflow-x-auto"
            aria-label="Roles and permissions"
          >
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={cn(tableHeadClass, "w-[8rem]")}>Roles</th>
                  <th className={tableHeadClass}>Permission</th>
                </tr>
              </thead>
              <tbody>
                {data.roles.map((role) => (
                  <tr key={role.id} data-testid={`admin-role-${role.id}`}>
                    <td className={cn(tableCellClass, "font-medium lowercase")}>
                      {role.id}
                    </td>
                    <td className={tableCellClass}>
                      <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                        {role.permissions.map((permission) => (
                          <li key={permission.id} className="text-foreground">
                            {permission.label}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
