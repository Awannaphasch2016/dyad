// Model key names the Auto provider can use. Values stay out of this file.
// The canary database URL is never part of the copy.

export const autoModelKeyNames = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
];

export const optionalModelKeyNames = ["AWS_BEARER_TOKEN_BEDROCK"];

export const modelKeyNames = [...autoModelKeyNames, ...optionalModelKeyNames];

function present(env, name) {
  const value = env?.[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function assertModelKeyCopy(copy) {
  if (Object.hasOwn(copy ?? {}, "WEWEBPLUS_DATABASE_URL")) {
    throw new Error("Refusing to copy the database URL");
  }
  return copy;
}

export function modelKeysToCopy(source) {
  const copy = {};
  for (const name of modelKeyNames) {
    if (name === "WEWEBPLUS_DATABASE_URL") {
      throw new Error("Refusing to copy the database URL");
    }
    if (present(source, name)) copy[name] = source[name];
  }
  return assertModelKeyCopy(copy);
}

export function absentAutoKeys(source) {
  return autoModelKeyNames.filter((name) => !present(source, name));
}

export function autoKeysAfterCopy(source, destination) {
  return autoModelKeyNames.filter(
    (name) => present(source, name) || present(destination, name),
  );
}
