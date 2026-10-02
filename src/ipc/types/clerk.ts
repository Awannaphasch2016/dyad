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
  accountKind: z.enum(["private", "organization", "unconfigured"]).optional(),
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

export const ClerkPublishableKeySchema = z.object({
  publishableKey: z.string().nullable(),
});

export const SetSessionTokenParamsSchema = z.object({
  token: z.string().nullable(),
  /** Safari bridge only. Keeps that token off the Electron window slot. */
  bridge: z.boolean().optional(),
});

export const RemoveAdminMemberParamsSchema = z.object({
  userId: z.string(),
});

export const StampOrganizationAdminParamsSchema = z.object({
  organizationId: z.string(),
});

export const clerkContracts = {
  getPublishableKey: defineContract({
    channel: "clerk:get-publishable-key",
    input: z.void(),
    output: ClerkPublishableKeySchema,
  }),
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
  setSessionToken: defineContract({
    channel: "clerk:set-session-token",
    input: SetSessionTokenParamsSchema,
    output: z.void(),
  }),
  removeMember: defineContract({
    channel: "clerk:remove-member",
    input: RemoveAdminMemberParamsSchema,
    output: z.void(),
  }),
  stampOrganizationAdmin: defineContract({
    channel: "clerk:stamp-organization-admin",
    input: StampOrganizationAdminParamsSchema,
    output: z.void(),
  }),
} as const;

export const clerkClient = createClient(clerkContracts);
