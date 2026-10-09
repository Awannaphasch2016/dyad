import { requirePhaseApproval } from "@/control_plane/factory_records";
import { db } from "@/db";
import {
  approveFactoryPhase,
  FactoryHostError,
  readFactoryState,
} from "@/main/factory_host_service";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { factoryHostContracts } from "../types/factory_host";

export function registerFactoryHostHandlers() {
  const run = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof FactoryHostError) {
        throw new DyadError(
          error.message,
          error.statusCode === 404
            ? DyadErrorKind.NotFound
            : DyadErrorKind.Validation,
        );
      }
      throw error;
    }
  };
  createTypedHandler(factoryHostContracts.getState, async (_, { appId }) =>
    run(() => readFactoryState(db, appId)),
  );
  createTypedHandler(
    factoryHostContracts.approvePhase,
    async (event, { appId, phase }) => {
      await requirePhaseApproval(event, appId, phase);
      return run(() => approveFactoryPhase(db, appId, phase));
    },
  );
}
