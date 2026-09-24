import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const AdminRoleIdSchema = z.enum(["admin", "reviewer", "dev"]);

export const AdminMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  roleId: AdminRoleIdSchema,
  status: z.enum(["active", "invited"]),
});

export const AdminPermissionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const AdminRoleSchema = z.object({
  id: AdminRoleIdSchema,
  name: z.string(),
  permissions: z.array(AdminPermissionSchema),
});

export const AdminAccessSchema = z.object({
  configured: z.boolean(),
  signInUrl: z.string().nullable(),
  signUpUrl: z.string().nullable(),
  members: z.array(AdminMemberSchema),
  roles: z.array(AdminRoleSchema),
});

export const InviteAdminMemberParamsSchema = z.object({
  email: z.string(),
  roleId: AdminRoleIdSchema,
});

export const SetAdminMemberRoleParamsSchema = z.object({
  userId: z.string(),
  roleId: AdminRoleIdSchema,
});

export const clerkContracts = {
  getAccess: defineContract({
    channel: "clerk:get-access",
    input: z.void(),
    output: AdminAccessSchema,
  }),
  inviteMember: defineContract({
    channel: "clerk:invite-member",
    input: InviteAdminMemberParamsSchema,
    output: AdminMemberSchema,
  }),
  setMemberRole: defineContract({
    channel: "clerk:set-member-role",
    input: SetAdminMemberRoleParamsSchema,
    output: AdminMemberSchema,
  }),
} as const;

export const clerkClient = createClient(clerkContracts);
