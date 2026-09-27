import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveAccountSession } from "@/control_plane/access";
import { getControlPlaneDb } from "@/control_plane/db";
import {
  readAccountConnection,
  upsertAccountConnection,
} from "@/control_plane/repository";
import { encryptSecret } from "@/control_plane/secrets";
import { copyAppToAccount, moveAppToAccount } from "@/control_plane/transfer";
import { accountContracts } from "../types/account";
import { createTypedHandler } from "./base";

export function registerAccountHandlers() {
  createTypedHandler(accountContracts.getContext, async (event) => {
    const sharing = Boolean(process.env.WEWEBPLUS_DATABASE_URL?.trim());
    const session = await resolveAccountSession(event).catch((error) => {
      if (error instanceof DyadError && error.kind === DyadErrorKind.Auth) {
        throw error;
      }
      throw error;
    });
    if (session.mode !== "signed-in") {
      return { sharing, account: null };
    }
    return {
      sharing,
      account: {
        type: session.account.type,
        id: session.account.id,
        name: session.account.type === "user" ? "Private" : session.account.id,
      },
    };
  });

  createTypedHandler(accountContracts.moveApp, async (event, params) => {
    await moveAppToAccount(event, params.appId, {
      type: params.ownerType,
      id: params.ownerId,
    });
  });

  createTypedHandler(accountContracts.copyApp, async (event, params) => {
    const appId = await copyAppToAccount(event, params.appId, {
      type: params.ownerType,
      id: params.ownerId,
    });
    return { appId };
  });

  createTypedHandler(accountContracts.setConnection, async (event, params) => {
    const session = await resolveAccountSession(event);
    if (session.mode !== "signed-in") {
      throw new DyadError(
        "Sign in before saving an account connection.",
        DyadErrorKind.Auth,
      );
    }
    const plane = await getControlPlaneDb();
    if (!plane) {
      throw new DyadError(
        "The shared database is not configured.",
        DyadErrorKind.Precondition,
      );
    }
    const token = params.token.trim();
    if (!token) {
      throw new DyadError(
        "Enter the token for this connection.",
        DyadErrorKind.Validation,
      );
    }
    await upsertAccountConnection(plane, {
      owner: session.account,
      provider: params.provider,
      ciphertext: encryptSecret(token),
      githubOrg: params.githubOrg ?? null,
    });
  });

  createTypedHandler(accountContracts.connectionStatus, async (event) => {
    const session = await resolveAccountSession(event);
    if (session.mode !== "signed-in") {
      return { github: false, supabase: false };
    }
    const plane = await getControlPlaneDb();
    if (!plane) return { github: false, supabase: false };
    const [github, supabase] = await Promise.all([
      readAccountConnection(plane, session.account, "github"),
      readAccountConnection(plane, session.account, "supabase"),
    ]);
    return { github: Boolean(github), supabase: Boolean(supabase) };
  });
}
