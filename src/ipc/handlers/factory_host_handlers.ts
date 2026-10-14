import { db } from "@/db";
import {
  approveFactoryPhase,
  FactoryHostError,
  readFactoryState,
} from "@/main/factory_host_service";
import { submitFactoryGateVerdict } from "@/main/factory_orchestrator";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { factoryHostContracts } from "../types/factory_host";

function asDyadError(error: unknown): never {
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

export function registerFactoryHostHandlers() {
  const run = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      asDyadError(error);
    }
  };
  createTypedHandler(factoryHostContracts.getState, async (_, { appId }) =>
    run(() => readFactoryState(db, appId)),
  );
  createTypedHandler(
    factoryHostContracts.approvePhase,
    async (_, { appId, phase }) => {
      const state = run(() => readFactoryState(db, appId));
      if (state.formula) {
        try {
          return await submitFactoryGateVerdict(db, appId, phase);
        } catch (error) {
          asDyadError(error);
        }
      }
      return run(() => approveFactoryPhase(db, appId, phase));
    },
  );
}
